import * as JiraApi from 'jira-client';

const JIRA_HOST = 'honeycomb.jira.com';
const JIRA_USER = 'derek.bringewatt@c2fo.com';
const JIRA_USER_TOKEN = process.env.JIRA_USER_TOKEN;
// https://jira.talendforge.org/rest/api/2/issue/createmeta?projectKeys=XXXX&expand=projects.issuetypes.fields)
let jira;

export async function createJiraIssues(inputData, listoData) {
  const projectDetails = inputData.projectMetaResponses;
  const selectedRisks = inputData.selectedRisks;
  checkEnvVars(['JIRA_USER_TOKEN']);

  try {
    jira = new JiraApi({
      protocol: 'https',
      host: JIRA_HOST,
      username: JIRA_USER,
      password: JIRA_USER_TOKEN,
      apiVersion: '2',
      strictSSL: true,
    });

    // prob going to have get username id as well face palm
    const featureIssueKey = await getIssueKey(inputData);
    const projectKey = await getProjectKey(inputData);
    const issueMeta = await jira.getIssueCreateMetadata({
      projectKeys: [projectKey],
    });
    const epicIssueType = getTaskTypeId(issueMeta, 'Epic');
    const storyIssueType = getTaskTypeId(issueMeta, 'Story');
    const subTaskIssueType = getTaskTypeId(issueMeta, 'Subtask');
    const doneTransitionTypeId = await getTransitionTypeId(
      jira,
      featureIssueKey,
      'Done',
    );
    const assignee = await jira.searchUsers({
      query: projectDetails.assigneeEmail,
    });

    const mainEpic = await createMainEpic(
      epicIssueType,
      projectKey,
      projectDetails,
      selectedRisks,
      assignee[0],
    );

    await linkMainEpicToFeatureEpic(mainEpic, featureIssueKey);

    await createSubTasks(
      mainEpic,
      inputData,
      listoData,
      projectKey,
      storyIssueType,
      subTaskIssueType,
      doneTransitionTypeId,
      assignee[0],
    );

    return { shortUrl: 'https://' + JIRA_HOST + '/browse/' + mainEpic.key };
  } catch (err) {
    throw new Error(`${err}`);
  }
}

async function linkMainEpicToFeatureEpic(mainIssueKey, featureIssueKey) {
  try {
    let payload = {
      type: {
        name: 'Blocks',
      },
      inwardIssue: {
        key: mainIssueKey.key,
      },
      outwardIssue: {
        key: featureIssueKey,
      },
    };

    const result = await jira.issueLink(payload);

    console.log(`JIRA ${featureIssueKey} was linked to ${mainIssueKey.key}`);
    return result;
  } catch (e) {
    console.log(e.message);
    throw new Error('Linking Main Epic to Feature Epic Failed: ' + e.message);
  }
}

//https://jira.talendforge.org/rest/api/2/issue/createmeta?projectKeys=xx&expand=projects.issuetypes.fields
async function createMainEpic(
  issueTypeId,
  projectKey,
  projectDetails,
  selectedRisks,
  assignee,
) {
  try {
    let risks = '';
    for (const r of selectedRisks) {
      risks += `-  ${r.text} : ${r.selection} \n`;
    }
    let payload = {
      fields: {
        issuetype: { id: issueTypeId },
        summary: `Security Review For: ${projectDetails.featureName} [${projectDetails.riskLevel}]`,
        project: { key: projectKey },
        labels: [
          'risk-' + projectDetails.riskLevel.split(' ')[0].toLowerCase(),
        ],
        description: `h3. *Reviewing Epic:* ${projectDetails.ticketLink}
            h3. *Project risks:* 
            ${risks}
            h3. *Team Slack channel:* ${projectDetails.slackTeam || ''}
            h3. *People involved in the assessment:* ${projectDetails.slackUserName ||
              ''}
            h3. *Documentation link:* ${projectDetails.codeLocation || ''}
            h3. *Created By:* [~${assignee.displayName}]
            `,
        assignee: { id: assignee.accountId },
      },
    };

    const result = await jira.addNewIssue(payload);

    console.log('Main Epic created successfully, ID: ' + result.key);
    return result;
  } catch (e) {
    console.log(e.message);
    throw new Error('Creating Main Epic Failed: ' + e.message);
  }
}

async function createSubTasks(
  parentTask,
  inputdata,
  listodata,
  projectKey,
  storyIssueTypeId,
  subTaskIssueTypeId,
  doneTransitionTypeId,
  assignee,
) {
  const moduleSubTasksProms = [];

  for (const category in inputdata.selectedModulesByCategory) {
    moduleSubTasksProms.push(
      createTasksForStory(
        parentTask,
        category,
        inputdata,
        listodata,
        projectKey,
        subTaskIssueTypeId,
        storyIssueTypeId,
        doneTransitionTypeId,
        assignee,
      ),
    );
  }
  return Promise.all(moduleSubTasksProms);
}

async function createTasksForStory(
  parentIssue,
  category,
  inputData,
  listoData,
  projectKey,
  subTaskIssueId,
  storyIssueTypeId,
  doneTransitionTypeId,
  assignee,
) {
  const selectedCategory = listoData.data.modules[category];
  try {
    for (let moduleKey of inputData.selectedModulesByCategory[category]) {
      let payload = {
        fields: {
          issuetype: { id: storyIssueTypeId },
          summary: `[${capitalize(category)}] - ${capitalize(moduleKey)}`,
          description:
            selectedCategory[moduleKey].assessmentQuestion +
            '\n\n' +
            selectedCategory[moduleKey].resources,
          project: { key: projectKey },
          parent: { key: parentIssue.key },
          assignee: { id: assignee.accountId },
        },
      };

      const storyIssue = await jira.addNewIssue(payload);

      console.log('Jira Story created successfully, ID: ' + storyIssue.key);

      for (let checkCategory in selectedCategory[moduleKey].checkLists) {
        selectedCategory[moduleKey].checkLists[checkCategory].forEach(
          checkList => {
            const completed = checkList.tools
              ? checkList.tools.some(checklistTool =>
                  inputData.selectedTools.includes(checklistTool),
                )
              : false;

            let payload = {
              fields: {
                issuetype: { id: subTaskIssueId },
                summary: checkList.question,
                project: { key: projectKey },
                description: ``,
                parent: { key: storyIssue.key },
                assignee: { id: assignee.accountId },
              },
            };

            if (completed) {
              payload['transition'] = {
                id: doneTransitionTypeId,
              };
            }

            try {
              const re = jira.addNewIssue(payload);
              console.log(`Added ${re.key}`);
            } catch (e) {
              console.log(e.message);
              throw new Error('Calling JIRA API failed: ' + e.message);
            }
          },
        );
      }
    }
  } catch (e) {
    console.log(e.message);
    throw new Error(e.message);
  }
}

// ===========================================================================
//                      Helpers
// ===========================================================================

function capitalize(s) {
  if (typeof s !== 'string') return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function getTransitionTypeId(jira, issueId, transitionName) {
  let transId = 0;
  const issue = await jira.listTransitions(issueId);
  issue.transitions.forEach(transition => {
    if (transition.name === transitionName) {
      transId = transition.id;
      return;
    }
  });
  return transId;
}

function getIssueKey(inputData) {
  const projIdTicketId = inputData.projectMetaResponses.ticketLink.split('/');
  return projIdTicketId[projIdTicketId.length - 1];
}

function getProjectKey(inputData) {
  const projIdTicketId = inputData.projectMetaResponses.ticketLink.split('/');
  return projIdTicketId[projIdTicketId.length - 1].split('-')[0];
}

function getTaskTypeId(issueMeta, issueTypeName) {
  let issueTypeId = 0;
  if (issueMeta.projects.length === 0) {
    return issueTypeId;
  }

  issueMeta.projects[0].issuetypes.forEach(issueType => {
    if (issueType.name === issueTypeName) {
      issueTypeId = issueType.id;
      return;
    }
  });

  return issueTypeId;
}

function checkEnvVars(vars) {
  for (const v of vars) {
    if (!process.env[v]) {
      console.error(
        '[error]: The "' + v + '" environment variable is required',
      );
      process.exit(1);
    }
  }
}
