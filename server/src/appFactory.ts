import * as express from 'express';
import * as jira from './jira';
import * as slack from './slack';
import * as cors from 'cors';
import {
  DirectoryData,
  AssessmentResult,
  Meta,
  ProjectModel,
  QuickChecklistModel,
} from '../../frontend/src/types';
import { Repository } from './types';
const path = require('path');

const {
  FRONTEND_ASSETS_PATH,
  SLACK_CHANNEL_LINK,
  SLACK_TARGET_CHANNEL,
  TRELLO_BOARD_LINK,
  SERVER_URL,
} = process.env;

function buildProjectURL(
  scheme: string,
  host: string,
  projectId: string,
): string {
  // Support a custom URL, e.g. if listo is behind a reverse proxy
  const authority = SERVER_URL
    ? SERVER_URL.replace(/\/$/, '')
    : `${scheme}://${host}`;
  return `${authority}/project/${projectId}`;
}

function addMandatoryModules(
  inputData: AssessmentResult,
  listodata: DirectoryData,
): AssessmentResult {
  const categories = listodata.data.modules;
  for (let categoryKey of Object.keys(categories)) {
    const modules = categories[categoryKey];
    for (let moduleKey of Object.keys(modules)) {
      const module = modules[moduleKey];
      if (module.minimumRisk === 'Mandatory') {
        if (inputData.selectedModulesByCategory[categoryKey]) {
          inputData.selectedModulesByCategory[categoryKey].push(moduleKey);
        } else {
          inputData.selectedModulesByCategory[categoryKey] = [moduleKey];
        }
      }
    }
  }
  return inputData;
}

async function appFactory(db: Repository, listoData: DirectoryData) {
  const app = express();
  app.use(express.json());
  app.use(cors());
  app.disable('etag');

  if (FRONTEND_ASSETS_PATH) {
    app.use(express.static(FRONTEND_ASSETS_PATH));
  }

  app.get('/health', async (_req, res) => {
    res.json({ status: 200 });
  });

  const apiRouter = express.Router();

  apiRouter.get('/data.json', async (_, res) => {
    res.json(listoData);
  });

  apiRouter.get('/meta', async (_req, res) => {
    try {
      const meta: Meta = {
        slackChannel: SLACK_TARGET_CHANNEL,
        slackChannelLink: SLACK_CHANNEL_LINK,
        exampleTrelloBoardLink: TRELLO_BOARD_LINK,
      };
      res.json(meta);
    } catch (err) {
      console.error(' Failed to list all projects', err);
    }
  });

  apiRouter.post('/project', async (req, res) => {
    const inputData = addMandatoryModules(
      req.body as AssessmentResult,
      listoData,
    );
    let board = null;
    let projectId = null;

    try {
      const project: ProjectModel = { metaData: inputData };
      projectId = await db.create(project);
    } catch (err) {
      throw new Error(
        `Failed to store project ${projectId} in the database: ${err}.`,
      );
    }

    try {
      board = await jira.createJiraIssues(inputData, listoData);
    } catch (err) {
      try {
        console.log('Warning of failure via Slack');
        await slack.sendMessage(
          JSON.stringify({
            Status: `Listo failure to create Jira`,
            Project: projectId,
            ProjectDetails: inputData.projectMetaResponses,
            Environment: process.env.STAGE,
          }),
        );
      } catch (err) {
        throw new Error(
          `Failed to send Slack alert for Project ${projectId}: ${err}`,
        );
      }
      throw new Error(
        `Failed to create Jira tasks for project ${projectId}: ${err}.`,
      );
    }

    // try {
    //   board = await trello.createFullBoard(
    //     inputData.projectMetaResponses.boardName,
    //     inputData,
    //     listoData,
    //   );
    // } catch (err) {
    //   await slack.sendMessage(
    //     JSON.stringify({
    //       Status: `Failed to create Trello board for ${inputData.projectMetaResponses.boardName}.`,
    //       Project: buildProjectURL(req.protocol, req.hostname, projectId),
    //       ProjectDetails: inputData.projectMetaResponses,
    //       Environment: process.env.STAGE,
    //     }),
    //   );

    //   throw new Error(
    //     `Failed to create Trello board for project ${projectId}: ${err}.`,
    //   );
    // }

    // try {
    //   if (inputData.projectMetaResponses.trelloEmail) {
    //     await trello.addMember(
    //       board.id,
    //       inputData.projectMetaResponses.trelloEmail,
    //     );
    //   }
    // } catch (err) {
    //   // Logging the error but not failing the response. We might want to change this in the future to throw an error to the client.
    //   console.log(
    //     `Failed to add Trello user with email ${inputData.projectMetaResponses.trelloEmail} to project ${projectId}: ${err}.`,
    //   );
    // }

    try {
      await db.update(projectId, board.shortUrl);
    } catch (err) {
      throw new Error(
        `Failed to update project (${projectId}) with board url ${board.shortUrl}: ${err}.`,
      );
    }

    try {
      await slack.sendMessage(
        JSON.stringify({
          Status: `Project ${inputData.projectMetaResponses.featureName} Created Successfully!`,
          Project: buildProjectURL(req.protocol, req.hostname, projectId),
          ProjectDetails: inputData.projectMetaResponses,
          Epic: board.shortUrl,
          Environment: process.env.STAGE,
        }),
      );
    } catch (err) {
      throw new Error(
        `Failed to send Slack alert for Project ${projectId}: ${err}`,
      );
    }

    res.json({
      id: projectId,
      details: 'Listo Project Created Successfully',
      status: 200,
    });
  });

  apiRouter.post('/slack', async (req, res) => {
    try {
      const message = JSON.stringify(req.body);
      slack.sendMessage(message);
      res.sendStatus(204);
    } catch (err) {
      console.error('Failed send Slack alert', err);
    }
  });

  apiRouter.get('/project/:id', async (req, res) => {
    try {
      const project = await db.get(req.params.id);
      res.json({ project: project, status: 200 });
    } catch (err) {
      console.error(`Failed to find project with ${req.params.id}`, err);
      res.status(404).send(`Project not found`);
    }
  });

  apiRouter.get('/quick-checklist/:id', async (req, res) => {
    try {
      const quickChecklist = await db.getQuickChecklist(req.params.id);
      res.json({ quickChecklist: quickChecklist, status: 200 });
    } catch (err) {
      console.error(`Failed to find QuickChecklist with ${req.params.id}`, err);
      res.status(404).send(`QuickChecklist not found`);
    }
  });

  apiRouter.put('/quick-checklist', async (req, res) => {
    let id = null;

    try {
      const quickChecklist = req.body as QuickChecklistModel;
      id = await db.upsertQuickChecklist(quickChecklist);
    } catch (err) {
      throw new Error(
        `Failed to store Quickchecklist with ID ${id} in the database: ${err}.`,
      );
    }
    res.json({
      id: id,
      details: 'Listo QuickChecklist Saved Successfully',
      status: 200,
    });
  });

  app.use('/api', apiRouter);

  // support client side routing per https://github.com/reach/router/blob/master/examples/crud/README.md#serving-apps-with-client-side-routing
  if (FRONTEND_ASSETS_PATH) {
    app.get('/*', (_req, res) => {
      res.sendFile(path.resolve(path.join(FRONTEND_ASSETS_PATH, 'index.html')));
    });
  }

  return app;
}

export default appFactory;
