/**
 * Port-forward rules for one SSH session — fetches the current list, then
 * keeps it in sync with backend state changes via portForward:update events.
 */

import { useCallback, useEffect, useState } from "react";
import { ipc } from "@renderer/lib/ipc";
import type { PortForwardRule, PortForwardType } from "@shared/ipc-contract";

export function usePortForwards(sessionId: string) {
  const [rules, setRules] = useState<PortForwardRule[]>([]);

  useEffect(() => {
    let canceled = false;
    ipc.portForward.list({ sessionId }).then((list) => {
      if (!canceled) setRules(list);
    });
    return () => {
      canceled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    return ipc.portForward.onUpdate(({ rule }) => {
      if (rule.sessionId !== sessionId) return;
      setRules((prev) => {
        if (rule.state === "stopped") return prev.filter((r) => r.id !== rule.id);
        const next = prev.filter((r) => r.id !== rule.id);
        next.push(rule);
        return next;
      });
    });
  }, [sessionId]);

  const startForward = useCallback(
    async (params: {
      type: PortForwardType;
      srcHost?: string;
      srcPort: number;
      dstHost?: string;
      dstPort?: number;
    }) => {
      const rule = await ipc.portForward.start({ sessionId, ...params });
      setRules((prev) => [...prev.filter((r) => r.id !== rule.id), rule]);
      return rule;
    },
    [sessionId],
  );

  const stopForward = useCallback(async (id: string) => {
    await ipc.portForward.stop({ id });
    setRules((prev) => prev.filter((r) => r.id !== id));
  }, []);

  return { rules, startForward, stopForward };
}
