// === AI Medicine Collective: topic chat ===
//
// Loaded on chat.html, after the Supabase library and auth.js (it uses db, el,
// button, avatar, formatDate and getSessionAndProfile from there; the scripts
// share one global scope, so top-level names here must not repeat names in
// auth.js, hub.js or script.js).
//
// Who can read, post or delete is enforced by the database
// (supabase/migrations/005_topic_chat.sql), not by this file.

const CHAT_PAGE_SIZE = 50;      // messages loaded at a time
const CHAT_POLL_MS = 20000;     // safety net if live updates drop
const CHAT_MAX_LENGTH = 2000;   // must match the CHECK in migration 005

const CHAT_MESSAGE_COLUMNS =
  "id, topic_id, body, created_at, " +
  "author:profiles!chat_messages_author_id_fkey(id, full_name, email, avatar_url)";

// "14:05" for today, "Oct 3, 2026 14:05" for earlier days
function chatTime(iso) {
  const when = new Date(iso);
  const time = when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return when.toDateString() === new Date().toDateString() ? time : `${formatDate(iso)} ${time}`;
}

function initChatPage() {
  const app = document.getElementById("chat-app");
  if (!app) return;

  let me = null;
  let topics = [];
  let topic = null;        // the open topic
  let messages = [];       // oldest first
  let channel = null;      // live-update subscription for the open topic
  let pollTimer = null;
  let loadingNew = false;

  const isModerator = () => me.role === "moderator" || me.role === "admin";

  // Page skeleton, built once the person is confirmed as a member
  const topicBar = el("div", "hub-toolbar chat-topics");
  topicBar.setAttribute("role", "group");
  topicBar.setAttribute("aria-label", "Chat topics");
  const topicTitle = el("h3", "subsection-title chat-topic-title");
  const topicNote = el("p", "note chat-topic-note");
  const earlier = button("LOAD EARLIER MESSAGES", "chat-earlier", () => loadEarlier());
  const log = el("ul", "chat-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  log.setAttribute("aria-label", "Messages");
  log.tabIndex = 0;
  const status = el("p", "join-status chat-status");
  status.setAttribute("role", "status");

  const form = el("form", "chat-composer");
  const inputLabel = el("label", "join-label", "Message");
  inputLabel.htmlFor = "chat-input";
  const input = el("textarea", "join-input");
  input.id = "chat-input";
  input.rows = 2;
  input.maxLength = CHAT_MAX_LENGTH;
  input.required = true;
  input.placeholder = "Ask anything. Enter sends, Shift+Enter adds a line.";
  const send = el("button", "join-submit", "> Send");
  send.type = "submit";
  form.append(inputLabel, input, send);

  function setStatus(text, isError) {
    status.textContent = text || "";
    status.classList.toggle("is-error", !!isError);
  }

  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  const scrollToBottom = () => { log.scrollTop = log.scrollHeight; };

  /* ---- topics ---- */

  async function loadTopics() {
    const { data, error } = await db
      .from("chat_topics")
      .select("id, name, description, position")
      .eq("archived", false)
      .order("position", { ascending: true });
    if (error) throw error;
    topics = data;
  }

  function renderTopicBar() {
    topicBar.replaceChildren();
    for (const item of topics) {
      const tab = button(item.name.toUpperCase(), "hub-tab chat-tab", () => openTopic(item.id, true));
      tab.setAttribute("aria-pressed", String(!!topic && item.id === topic.id));
      topicBar.append(tab);
    }
    if (isModerator()) {
      topicBar.append(button("+ NEW TOPIC", "hub-tab chat-tab chat-tab--new", addTopic));
    }
  }

  async function addTopic() {
    const name = (window.prompt("Name of the new topic:", "") || "").trim();
    if (!name) return;
    const description = (window.prompt("One-line description (optional):", "") || "").trim();
    const position = Math.max(0, ...topics.map((t) => t.position)) + 10;
    const { data, error } = await db
      .from("chat_topics")
      .insert({ name, description: description || null, position, created_by: me.id })
      .select("id")
      .maybeSingle();
    if (error) return setStatus(`> COULD NOT ADD THE TOPIC: ${error.message}`, true);
    await loadTopics();
    if (!app.contains(log)) return window.location.reload(); // first topic ever: build the page
    openTopic(data ? data.id : topics[topics.length - 1].id, true);
  }

  /* ---- messages ---- */

  function messageNode(message) {
    const item = el("li", "chat-message");
    item.dataset.id = message.id;
    const author = message.author || {};
    if (author.id === me.id) item.classList.add("chat-message--own");

    const text = el("div", "chat-text");
    const meta = el("div", "chat-meta");
    const time = el("time", "chat-time", chatTime(message.created_at));
    time.dateTime = message.created_at;
    meta.append(el("span", "chat-author", author.full_name || author.email || "Member"), time);
    text.append(meta, el("div", "chat-body", message.body));
    item.append(avatar(author), text);

    if (isModerator() || author.id === me.id) {
      const remove = button("×", "chat-delete", async () => {
        if (!window.confirm("Delete this message?")) return;
        const { error } = await db.from("chat_messages").delete().eq("id", message.id);
        if (error) return setStatus("> COULD NOT DELETE THE MESSAGE.", true);
        removeMessage(message.id);
      });
      remove.setAttribute("aria-label", "Delete message");
      item.append(remove);
    }
    return item;
  }

  function removeMessage(id) {
    if (!id) return;
    messages = messages.filter((m) => m.id !== id);
    const node = log.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (node) node.remove();
    showEmptyNote();
  }

  function showEmptyNote() {
    const note = log.querySelector(".chat-empty");
    if (!messages.length && !note) {
      log.append(el("li", "note chat-empty", "// No messages yet. Start the conversation."));
    } else if (messages.length && note) {
      note.remove();
    }
  }

  async function loadLatest() {
    const { data, error } = await db
      .from("chat_messages")
      .select(CHAT_MESSAGE_COLUMNS)
      .eq("topic_id", topic.id)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE);
    if (error) return setStatus("> COULD NOT LOAD MESSAGES. Please refresh the page.", true);

    messages = data.slice().reverse();
    log.replaceChildren(...messages.map(messageNode));
    earlier.hidden = data.length < CHAT_PAGE_SIZE;
    showEmptyNote();
    scrollToBottom();
  }

  async function loadEarlier() {
    if (!messages.length) return;
    earlier.disabled = true;
    const { data, error } = await db
      .from("chat_messages")
      .select(CHAT_MESSAGE_COLUMNS)
      .eq("topic_id", topic.id)
      .lt("created_at", messages[0].created_at)
      .order("created_at", { ascending: false })
      .limit(CHAT_PAGE_SIZE);
    earlier.disabled = false;
    if (error) return setStatus("> COULD NOT LOAD EARLIER MESSAGES.", true);

    const older = data.slice().reverse();
    const heightBefore = log.scrollHeight;
    messages = [...older, ...messages];
    log.prepend(...older.map(messageNode));
    log.scrollTop += log.scrollHeight - heightBefore; // keep the view where it was
    earlier.hidden = data.length < CHAT_PAGE_SIZE;
  }

  // Fetch anything newer than what's shown. Called by live updates, by the
  // polling safety net, and after sending.
  async function loadNew() {
    if (!topic || loadingNew) return;
    loadingNew = true;
    try {
      const topicId = topic.id;
      let query = db.from("chat_messages").select(CHAT_MESSAGE_COLUMNS).eq("topic_id", topicId);
      if (messages.length) query = query.gte("created_at", messages[messages.length - 1].created_at);
      const { data, error } = await query.order("created_at", { ascending: true }).limit(CHAT_PAGE_SIZE * 2);
      if (error || !topic || topic.id !== topicId) return;

      const known = new Set(messages.map((m) => m.id));
      const fresh = data.filter((m) => !known.has(m.id));
      if (!fresh.length) return;
      const stick = nearBottom();
      messages.push(...fresh);
      log.append(...fresh.map(messageNode));
      showEmptyNote();
      if (stick) scrollToBottom();
    } finally {
      loadingNew = false;
    }
  }

  function stopListening() {
    if (channel) {
      db.removeChannel(channel);
      channel = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startListening() {
    channel = db
      .channel(`chat:${topic.id}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages", filter: `topic_id=eq.${topic.id}` },
        () => loadNew())
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: "chat_messages" },
        (payload) => removeMessage(payload.old && payload.old.id))
      .subscribe();
    pollTimer = setInterval(() => { if (!document.hidden) loadNew(); }, CHAT_POLL_MS);
  }

  async function openTopic(id, updateAddress) {
    const next = topics.find((t) => t.id === id) || topics[0];
    if (!next) return;
    stopListening();
    topic = next;
    setStatus("");
    renderTopicBar();
    topicTitle.textContent = `// ${topic.name}`;
    topicNote.textContent = topic.description || "";
    topicNote.hidden = !topic.description;
    log.replaceChildren(el("li", "note", "> LOADING MESSAGES..."));
    if (updateAddress) {
      history.replaceState(null, "", `${window.location.pathname}?topic=${encodeURIComponent(topic.id)}`);
    }
    await loadLatest();
    startListening();
  }

  /* ---- sending ---- */

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || !topic) return;
    send.disabled = true;
    const { error } = await db
      .from("chat_messages")
      .insert({ topic_id: topic.id, author_id: me.id, body });
    send.disabled = false;
    if (error) return setStatus("> COULD NOT SEND. Please try again.", true);
    input.value = "";
    setStatus("");
    await loadNew();
    scrollToBottom();
    input.focus();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  window.addEventListener("pagehide", stopListening);

  /* ---- start ---- */

  const gate = (text, linkText) => {
    const link = el("a", "account-mod-link", linkText);
    link.href = "account.html";
    app.replaceChildren(el("p", "account-status", "> MEMBERS ONLY"), el("p", null, text), link);
  };

  (async () => {
    app.replaceChildren(el("p", "account-status", "> CHECKING ACCESS..."));
    try {
      const { session, profile } = await getSessionAndProfile();
      if (!session) {
        return gate("Chat is where members ask questions and trade ideas, organized by topic.",
          "> SIGN IN OR REQUEST MEMBERSHIP");
      }
      if (!profile || !["member", "moderator", "admin"].includes(profile.role)) {
        return gate("Your membership isn't active yet. Chat opens once a moderator approves your request.",
          "> CHECK YOUR STATUS");
      }
      me = profile;

      await loadTopics();
      if (!topics.length) {
        app.replaceChildren(el("p", "note", "// No chat topics yet."));
        if (isModerator()) app.append(button("+ NEW TOPIC", "hub-tab chat-tab chat-tab--new", addTopic), status);
        return;
      }

      app.replaceChildren(
        topicBar, topicTitle, topicNote, earlier, log, form, status,
        el("p", "join-hint", "// Members only. Be kind, and never post patient information.")
      );
      await openTopic(new URLSearchParams(window.location.search).get("topic"), false);
    } catch (err) {
      console.error(err);
      app.replaceChildren(el("p", "account-status is-error", "> COULD NOT LOAD CHAT. Please refresh the page."));
    }
  })();
}

document.addEventListener("DOMContentLoaded", initChatPage);
