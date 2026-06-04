// The package index is CLIENT-SAFE: constants only, no Node built-ins. The web
// bundle imports constants from here, so it must never pull in env.ts (which
// uses node:fs). Server code imports env loaders from '@counter/config/env'.
export * from './constants.ts';
