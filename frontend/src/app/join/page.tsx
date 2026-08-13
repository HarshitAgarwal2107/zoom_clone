"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Join() {
  const router = useRouter();
  const [code, setCode] = useState("");

  function submit() {
    // Accept the display format too, so a pasted "123 4567 8901" works.
    router.push(`/meeting/${code.replace(/\D/g, "")}`);
  }

  return (
    <main>
      <h1>Join a meeting</h1>
      <input
        placeholder="123 4567 8901"
        value={code}
        onChange={(e) => setCode(e.target.value)}
      />
      <button onClick={submit} disabled={code.replace(/\D/g, "").length !== 11}>
        Join
      </button>
    </main>
  );
}
