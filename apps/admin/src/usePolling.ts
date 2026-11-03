import { useEffect, useState } from "react";
export function usePolling<T>(
  load: (signal: AbortSignal) => Promise<T>,
  interval = 2000,
) {
  const [state, setState] = useState<{ data?: T; error?: unknown }>({});
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    setState({});
    async function tick() {
      try {
        const data = await load(controller.signal);
        if (!controller.signal.aborted) setState({ data });
      } catch (error) {
        if (!controller.signal.aborted)
          setState((previous) => ({ ...previous, error }));
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, interval);
    }
    void tick();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load, interval]);
  return state;
}
