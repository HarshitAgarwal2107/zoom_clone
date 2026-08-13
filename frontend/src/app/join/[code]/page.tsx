"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// Exists so invite links read naturally; it only forwards to the room.
export default function JoinByCode() {
  const router = useRouter();
  const { code } = useParams<{ code: string }>();

  useEffect(() => {
    router.replace(`/meeting/${code}`);
  }, [router, code]);

  return <p>Joining...</p>;
}
