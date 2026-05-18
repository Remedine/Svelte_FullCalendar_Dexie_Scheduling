// src/routes/(app)/+layout.js
// )Disable SSR for the entire (app) group - fixes FullCalendar semVer prefetch error

export const ssr = false;
//export const prerender = false; // optional but recommended
