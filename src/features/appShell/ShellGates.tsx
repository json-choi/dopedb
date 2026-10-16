// App-wide blocking gates the shell mounts once: the Skill startup gate and the
// close/quit confirmation while manual transactions are open.
import ManualTransactionExitGuard from "../queries/ManualTransactionExitGuard";
import SkillStartupGate from "../skills/SkillStartupGate";

export default function ShellGates() {
  return (
    <>
      <SkillStartupGate />
      <ManualTransactionExitGuard />
    </>
  );
}
