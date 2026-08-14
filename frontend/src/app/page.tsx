// The dashboard is the landing page and renders signed out. It lives in
// dashboard/ so its relative "./dashboard.css" import keeps resolving; this
// route just re-exports it rather than moving the component.
export { default } from "./dashboard/page";
