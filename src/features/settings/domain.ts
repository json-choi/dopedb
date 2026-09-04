// Settings navigation is application state shared by the shell and the modal screen.
// Keeping the section identity outside `screens/` prevents feature state from
// depending on a presentation entry point.
export type SettingsSection =
  | "agent-tools"
  | "advanced"
  | "cli"
  | "privacy"
  | "safety"
  | "updates"
  | "language";
