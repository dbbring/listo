import React from 'react';
import CssBaseline from '@material-ui/core/CssBaseline';
import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import Typography from '@material-ui/core/Typography';
import Grid from '@material-ui/core/Grid';
import { useStyles } from '../styles';
import { Link } from '@reach/router';
import { ReactComponent as Logo } from '../c2fo.svg';

const Header = () => {
  const classes = useStyles({});
  return (
    <React.Fragment>
      <CssBaseline />
      <AppBar position="absolute" color="default" className={classes.appBar}>
        
        <Grid
          justify="space-between" // Add it here :)
          container 
          
        >
          <Grid item>
          <Toolbar>
          <Link to="/" className={classes.logo}>
            <div className={classes.logoContainer}>
            <Logo />
            </div>
          </Link>
          <Link to="/faq" className={classes.logo}>
            <Typography
              variant="h6"
              color="inherit"
              noWrap
              className={classes.menuItem}
            >
              FAQ
            </Typography>
          </Link>
          <Link to="/checklists" className={classes.logo}>
            <Typography
              variant="h6"
              color="inherit"
              noWrap
              className={classes.menuItem}
            >
              CHECKLISTS
            </Typography>
          </Link>
          </Toolbar>
          </Grid>

          <Grid item>
          <Toolbar>
          <Typography
              variant="h3"
              color="inherit"
              noWrap
              className={classes.menuTitle}
            >
              Automatic Security Review
            </Typography>
            </Toolbar>
          </Grid>
        </Grid>
      </AppBar>
    </React.Fragment>
  );
};

export default Header;
