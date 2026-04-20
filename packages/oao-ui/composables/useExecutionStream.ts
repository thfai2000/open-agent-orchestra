/**
 * Composable for SSE (Server-Sent Events) real-time streaming.
 * Handles connection, reconnection, and typed event dispatching.
 */
export function useExecutionStream(executionId: Ref<string>, options?: { enabled?: Ref<boolean> }) {
  const { authHeaders } = useAuth();

  const events = ref<Array<{ type: string; data: any; receivedAt: string }>>([]);
  const connected = ref(false);
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const listeners = new Map<string, Set<(data: any) => void>>();

  function on(eventType: string, callback: (data: any) => void) {
    if (!listeners.has(eventType)) listeners.set(eventType, new Set());
    listeners.get(eventType)!.add(callback);
    return () => listeners.get(eventType)?.delete(callback);
  }

  function emit(eventType: string, data: any) {
    const cbs = listeners.get(eventType);
    if (cbs) cbs.forEach(cb => cb(data));
    // Also emit wildcard
    const wildcardCbs = listeners.get('*');
    if (wildcardCbs) wildcardCbs.forEach(cb => cb({ type: eventType, ...data }));
  }

  function connect() {
    disconnect();

    const headers = authHeaders();
    const token = headers.Authorization?.replace('Bearer ', '') || '';
    if (!token || !executionId.value) return;

    const url = `/api/executions/${executionId.value}/stream?token=${encodeURIComponent(token)}`;
    eventSource = new EventSource(url);

    eventSource.addEventListener('connected', () => {
      connected.value = true;
    });

    // Listen for all execution event types
    const eventTypes = [
      'execution.started', 'execution.status', 'execution.completed',
      'execution.failed', 'execution.cancelled',
      'step.started', 'step.progress', 'step.completed', 'step.failed',
    ];

    for (const type of eventTypes) {
      eventSource.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          events.value.push({ type, data, receivedAt: new Date().toISOString() });
          emit(type, data);
        } catch { /* ignore parse errors */ }
      });
    }

    eventSource.onerror = () => {
      connected.value = false;
      eventSource?.close();
      eventSource = null;
      // Reconnect after 3s
      reconnectTimer = setTimeout(() => {
        if (options?.enabled?.value !== false) connect();
      }, 3000);
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    connected.value = false;
  }

  // Auto-connect when enabled and executionId is available
  const shouldConnect = computed(() => {
    return (options?.enabled?.value !== false) && !!executionId.value;
  });

  watch(shouldConnect, (val) => {
    if (val) connect();
    else disconnect();
  }, { immediate: true });

  // Cleanup on unmount
  onUnmounted(() => {
    disconnect();
    listeners.clear();
  });

  return { events, connected, on, connect, disconnect };
}

/**
 * Composable for SSE streaming on the executions listing page.
 */
export function useExecutionListStream() {
  const { authHeaders } = useAuth();

  const connected = ref(false);
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const listeners = new Map<string, Set<(data: any) => void>>();

  function on(eventType: string, callback: (data: any) => void) {
    if (!listeners.has(eventType)) listeners.set(eventType, new Set());
    listeners.get(eventType)!.add(callback);
    return () => listeners.get(eventType)?.delete(callback);
  }

  function connect() {
    disconnect();
    const headers = authHeaders();
    const token = headers.Authorization?.replace('Bearer ', '') || '';
    if (!token) return;

    const url = `/api/executions/stream/all?token=${encodeURIComponent(token)}`;
    eventSource = new EventSource(url);

    eventSource.addEventListener('connected', () => {
      connected.value = true;
    });

    const eventTypes = [
      'execution.created', 'execution.started', 'execution.status',
      'execution.completed', 'execution.failed', 'execution.cancelled',
      'step.started', 'step.progress', 'step.completed', 'step.failed',
    ];

    for (const type of eventTypes) {
      eventSource.addEventListener(type, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const cbs = listeners.get(type);
          if (cbs) cbs.forEach(cb => cb(data));
          const wildcardCbs = listeners.get('*');
          if (wildcardCbs) wildcardCbs.forEach(cb => cb({ type, ...data }));
        } catch { /* ignore */ }
      });
    }

    eventSource.onerror = () => {
      connected.value = false;
      eventSource?.close();
      eventSource = null;
      reconnectTimer = setTimeout(connect, 3000);
    };
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (eventSource) { eventSource.close(); eventSource = null; }
    connected.value = false;
  }

  onMounted(connect);
  onUnmounted(() => { disconnect(); listeners.clear(); });

  return { connected, on, connect, disconnect };
}
