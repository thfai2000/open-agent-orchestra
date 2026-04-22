export function useConversationStream(conversationId: Ref<string>, options?: { enabled?: Ref<boolean> }) {
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

  function emit(eventType: string, data: any) {
    const callbacks = listeners.get(eventType);
    if (callbacks) callbacks.forEach((callback) => callback(data));

    const wildcardCallbacks = listeners.get('*');
    if (wildcardCallbacks) wildcardCallbacks.forEach((callback) => callback({ type: eventType, ...data }));
  }

  function connect() {
    disconnect();

    if (typeof EventSource === 'undefined') return;

    const headers = authHeaders();
    const token = headers.Authorization?.replace('Bearer ', '') || '';
    if (!token || !conversationId.value) return;

    const url = `/api/conversations/${conversationId.value}/stream?token=${encodeURIComponent(token)}`;
    eventSource = new EventSource(url);

    eventSource.addEventListener('connected', () => {
      connected.value = true;
    });

    const eventTypes = [
      'conversation.message.started',
      'conversation.message.delta',
      'conversation.message.reasoning',
      'conversation.message.reasoning_delta',
      'conversation.message.completed',
      'conversation.message.failed',
      'conversation.tool.execution_start',
      'conversation.tool.execution_complete',
      'conversation.turn.started',
      'conversation.turn.completed',
    ];

    for (const type of eventTypes) {
      eventSource.addEventListener(type, (event: MessageEvent) => {
        try {
          emit(type, JSON.parse(event.data));
        } catch {
          // ignore malformed stream payloads
        }
      });
    }

    eventSource.onerror = () => {
      connected.value = false;
      eventSource?.close();
      eventSource = null;
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

  const shouldConnect = computed(() => (options?.enabled?.value !== false) && !!conversationId.value);

  watch(shouldConnect, (value) => {
    if (value) connect();
    else disconnect();
  }, { immediate: true });

  onUnmounted(() => {
    disconnect();
    listeners.clear();
  });

  return { connected, on, connect, disconnect };
}