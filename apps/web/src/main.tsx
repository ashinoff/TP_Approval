import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.js';
import './style.css';
import './registry.css';
import './word.css';
import './practical.css';
import './engineer.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
