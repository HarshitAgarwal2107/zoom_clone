// Mirrors the server-side rules in backend/app/passwords.py. Extracted only
// because there are now three call sites: signup, forgot-password, profile.

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];
const MAX_RUN = 4;

// Direction-sensitive, exactly like the server: "qwert" is a run, but walking
// back and forth ("ewer") is not.
function hasRun(password: string) {
  const lowered = password.toLowerCase();
  let same = 1;
  let ascending = 1;
  let descending = 1;
  for (let i = 1; i < lowered.length; i++) {
    const prev = lowered.charCodeAt(i - 1);
    const cur = lowered.charCodeAt(i);
    same = cur === prev ? same + 1 : 1;
    ascending = cur === prev + 1 ? ascending + 1 : 1;
    descending = cur === prev - 1 ? descending + 1 : 1;
    if (Math.max(same, ascending, descending) >= MAX_RUN) return true;
  }
  for (const row of KEYBOARD_ROWS) {
    let forward = 1;
    let backward = 1;
    for (let i = 1; i < lowered.length; i++) {
      const a = row.indexOf(lowered[i - 1]);
      const b = row.indexOf(lowered[i]);
      const step = a !== -1 && b !== -1 ? b - a : null;
      forward = step === 1 ? forward + 1 : 1;
      backward = step === -1 ? backward + 1 : 1;
      if (Math.max(forward, backward) >= MAX_RUN) return true;
    }
  }
  return false;
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={`password-hint-mark ${ok ? "pass" : "fail"}`} aria-hidden="true">
      {ok ? "✓" : "✕"}
    </span>
  );
}

export default function PasswordHints({
  show,
  value = "",
}: {
  show: boolean;
  value?: string;
}) {
  if (!show) return null;

  const must = [
    { label: "At least 8 characters", ok: value.length >= 8 },
    { label: "At least 1 letter (a, b, c...)", ok: /[a-zA-Z]/.test(value) },
    { label: "At least 1 number", ok: /[0-9]/.test(value) },
    { label: "At least 1 uppercase letter", ok: /[A-Z]/.test(value) },
    { label: "At least 1 lowercase letter", ok: /[a-z]/.test(value) },
  ];
  const noRun = value.length > 0 && !hasRun(value);

  return (
    <div className="password-hints-popover">
      <div className="password-hints-title">Password must include:</div>
      <ul className="password-hints-list checked">
        {must.map((rule) => (
          <li key={rule.label} className={rule.ok ? "pass" : "fail"}>
            <Mark ok={rule.ok} />
            {rule.label}
          </li>
        ))}
      </ul>
      <div className="password-hints-title">Password must not include:</div>
      <ul className="password-hints-list checked">
        <li className={noRun ? "pass" : "fail"}>
          <Mark ok={noRun} />
          4 or more consecutive characters (e.g. &quot;1111&quot;, &quot;12345&quot;,
          &quot;abcde&quot;, or &quot;qwert&quot;)
        </li>
      </ul>
    </div>
  );
}
