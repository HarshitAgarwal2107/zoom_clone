// Mirrors the server-side rules in backend/app/passwords.py. Extracted only
// because there are now three call sites: signup, forgot-password, profile.
export default function PasswordHints({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="password-hints-popover">
      <div className="password-hints-title">Password must include:</div>
      <ul className="password-hints-list">
        <li>At least 8 characters</li>
        <li>At least 1 letter (a, b, c...)</li>
        <li>At least 1 number</li>
        <li>At least 1 uppercase letter</li>
        <li>At least 1 lowercase letter</li>
      </ul>
      <div className="password-hints-title">Password must not include:</div>
      <ul className="password-hints-list">
        <li>4 or more consecutive characters (e.g. &quot;1111&quot;, &quot;12345&quot;, &quot;abcde&quot;, or &quot;qwert&quot;)</li>
      </ul>
    </div>
  );
}
