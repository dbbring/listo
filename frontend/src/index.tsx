import React from 'react';
import ReactDOM from 'react-dom';
import './index.css';
import App from './App';
import { ThemeProvider } from '@material-ui/styles';
import { createMuiTheme } from '@material-ui/core';

const theme = createMuiTheme({
  palette: {
    primary: {
      main: '#6ba43a',
    },
    secondary: {
      main: '#095540',
    },
    error: {
      main: '#9556b7',
    },
  },
});

ReactDOM.render(
  <ThemeProvider theme={theme}>
    {' '}
    <App />
  </ThemeProvider>,
  document.getElementById('root'),
);
