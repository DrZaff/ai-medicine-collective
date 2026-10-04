// === AI Medicine Collective: inbox (private messages about projects) ===
//
// Loaded on inbox.html, after the Supabase library and auth.js (it uses db, el,
// button, avatar, formatDate, getSessionAndProfile and rememberUnread from
// there; the scripts share one global scope, so top-level names here must not
// repeat names in auth.js, hub.js, chat.js or script.js).
//
// A message is readable only by its sender and its recipient. That is enforced
// by the database (supabase/migrations/006_messages_and_resubmit.sql).

const INBOX_COLUMNS =
  "id, project_id, sender_id, recipient_id, body, created_at, read_at, " +
  "project:projects(id, title, kind), " +
  "sender:profiles!project_messages_sender_id_fkey(id, full_name, avatar_url), " +
  "recipient:profiles!project_messages_recipient_id_fkey(id, full_name, avatar_url)";

function initInboxPage() {
  const app = document.getElementById("inbox-app");
  if (!app) return;

  let me = null;

  const personName = (person) => (person && person.full_name) || "Member";

  // "14:05" for today, "Oct 3, 2026 14:05" for earlier days
  function messageTime(iso) {
    const when = new Date(iso);
    const time = when.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    return when.toDateString() === new Date().toDateString() ? time : `${formatDate(iso)} ${time}`;
  }

  function projectLink(project) {
    if (!project) return el("span", "note", "(no longer available)");
    const link = el("a", null, project.title);
    link.href = `${project.kind === "material" ? "learn.html" : "hub.html"}?project=${encodeURIComponent(project.id)}`;
    return link;
  }

  // One conversation = one project + one other person
  function buildThreads(messages) {
    const threads = new Map();
    for (const message of messages) {
      const mine = message.sender_id === me.id;
      const other = mine ? message.recipient : message.sender;
      const otherId = mine ? message.recipient_id : message.sender_id;
      const key = `${message.project_id}:${otherId}`;
      if (!threads.has(key)) {
        threads.set(key, { key, project: message.project, projectId: message.project_id, other, otherId, messages: [], unread: 0 });
      }
      const thread = threads.get(key);
      thread.messages.push(message);
      if (!mine && !message.read_at) thread.unread++;
    }
    const last = (thread) => thread.messages[thread.messages.length - 1].created_at;
    return [...threads.values()].sort((a, b) => (last(a) < last(b) ? 1 : -1));
  }

  function threadNode(thread, openKey) {
    const group = el("details", "resource-group inbox-thread");
    group.open = thread.unread > 0 || thread.key === openKey;

    const summary = el("summary", "resource-summary");
    summary.append(`// ${personName(thread.other)} · ${thread.project ? thread.project.title : "removed item"}`);
    if (thread.unread) summary.append(el("span", "member-tag inbox-new", `${thread.unread} NEW`));
    group.append(summary);

    const body = el("div", "resource-body");
    const about = el("p", "note");
    about.append("// About: ", projectLink(thread.project));
    body.append(about);

    const list = el("ul", "chat-log inbox-log");
    for (const message of thread.messages) {
      const mine = message.sender_id === me.id;
      const item = el("li", mine ? "chat-message chat-message--own" : "chat-message");
      const text = el("div", "chat-text");
      const meta = el("div", "chat-meta");
      const time = el("time", "chat-time", messageTime(message.created_at));
      time.dateTime = message.created_at;
      meta.append(el("span", "chat-author", mine ? "You" : personName(message.sender)), time);
      text.append(meta, el("div", "chat-body", message.body));
      item.append(avatar(mine ? me : message.sender || {}), text);
      list.append(item);
    }
    body.append(list);

    const form = el("form", "chat-composer");
    const label = el("label", "join-label", `Reply to ${personName(thread.other)}`);
    const input = el("textarea", "join-input");
    input.id = `inbox-reply-${thread.key.replace(/[^A-Za-z0-9]/g, "")}`;
    label.htmlFor = input.id;
    input.rows = 2;
    input.maxLength = 2000;
    input.required = true;
    input.placeholder = "Write a reply. No patient information.";
    const send = el("button", "join-submit", "> Reply");
    send.type = "submit";
    const status = el("p", "join-status");
    status.setAttribute("role", "status");
    form.append(label, input, send, status);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      const { error } = await db.from("project_messages").insert({
        project_id: thread.projectId, sender_id: me.id, recipient_id: thread.otherId, body: text,
      });
      if (error) {
        console.error(error);
        send.disabled = false;
        status.textContent = "> COULD NOT SEND. Please try again.";
        status.classList.add("is-error");
        return;
      }
      load(thread.key);
    });
    body.append(form);

    group.append(body);
    return group;
  }

  async function load(openKey) {
    const { data: messages, error } = await db
      .from("project_messages")
      .select(INBOX_COLUMNS)
      .order("created_at", { ascending: true });
    if (error) {
      console.error(error);
      app.replaceChildren(el("p", "account-status is-error", "> COULD NOT LOAD YOUR INBOX. Please refresh the page."));
      return;
    }

    const threads = buildThreads(messages);
    if (!threads.length) {
      app.replaceChildren(
        el("p", "note", "// No messages yet."),
        el("p", null, "When a member contacts you about one of your projects or materials, or replies to a message you sent, it shows up here.")
      );
    } else {
      const accordion = el("section", "resource-accordion");
      threads.forEach((thread) => accordion.append(threadNode(thread, openKey)));
      app.replaceChildren(accordion);
    }

    // Everything addressed to me has now been shown: mark it read
    const unreadIds = messages.filter((m) => m.recipient_id === me.id && !m.read_at).map((m) => m.id);
    if (unreadIds.length) {
      await db.from("project_messages").update({ read_at: new Date().toISOString() }).in("id", unreadIds);
    }
    rememberUnread(0);
  }

  (async () => {
    app.replaceChildren(el("p", "account-status", "> CHECKING ACCESS..."));
    try {
      const { session, profile } = await getSessionAndProfile();
      const gate = (text, linkText) => {
        const link = el("a", "account-mod-link", linkText);
        link.href = "account.html";
        app.replaceChildren(el("p", "account-status", "> MEMBERS ONLY"), el("p", null, text), link);
      };
      if (!session) return gate("Your inbox holds private messages about projects and materials.", "> SIGN IN OR REQUEST MEMBERSHIP");
      if (!profile || !["member", "moderator", "admin"].includes(profile.role)) {
        return gate("Your membership isn't active yet. Your inbox opens once a moderator approves your request.", "> CHECK YOUR STATUS");
      }
      me = profile;
      await load(null);
    } catch (err) {
      console.error(err);
      app.replaceChildren(el("p", "account-status is-error", "> COULD NOT LOAD YOUR INBOX. Please refresh the page."));
    }
  })();
}

document.addEventListener("DOMContentLoaded", initInboxPage);
