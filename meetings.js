// === AI Medicine Collective: meetings page (members only) ===
//
// Loaded on schedule.html, after the Supabase library and auth.js (it uses
// db, el, button, loadingBlock and getSessionAndProfile from there; the
// scripts share one global scope, so top-level names here must not repeat
// names in the other scripts).
//
// The Collective meets in the first week of each month. Members tick every
// half-hour slot they could make (4 to 7 PM Eastern, days 1 to 7 of next
// month); an admin confirms one, and everyone who ticked it is emailed a
// calendar invite. All of that is done by database functions (migration
// 016); this file only draws what meeting_poll() returns.

const MEETING_TIME_ZONE = "America/New_York";
const MEETING_TITLE = "AI Medicine Collective monthly meeting";

function initMeetingsPage() {
  const app = document.getElementById("meetings-app");
  if (!app) return;
  const archive = document.getElementById("meeting-archive");

  const dayLabel = (iso) => new Date(iso).toLocaleDateString("en-US",
    { timeZone: MEETING_TIME_ZONE, weekday: "long", month: "long", day: "numeric" });
  const timeLabel = (iso) => new Date(iso).toLocaleTimeString("en-US",
    { timeZone: MEETING_TIME_ZONE, hour: "numeric", minute: "2-digit" });
  // "2026-11-01" -> "November 2026" (read as a plain calendar date)
  const monthLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US",
    { timeZone: "UTC", month: "long", year: "numeric" });
  const dateLabel = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US",
    { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  // 20261103T220000Z, the form calendar files and Google Calendar expect
  const stamp = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const status = el("p", "account-status hub-status");
  status.setAttribute("role", "status");
  const say = (text, isError) => {
    status.textContent = text || "";
    status.classList.toggle("is-error", !!isError);
  };

  async function act(work, failText) {
    say("> WORKING...");
    const { data, error } = await work();
    if (error) {
      console.error(error);
      say(`${failText} ${error.message || ""}`.trim(), true);
      return undefined;
    }
    say("");
    return data === null || data === undefined ? true : data;
  }

  /* ---- a confirmed meeting ---- */

  function calendarFile(meeting) {
    const start = new Date(meeting.starts_at);
    const end = new Date(start.getTime() + meeting.minutes * 60000);
    const escape = (text) => String(text).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, " ");
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AI Medicine Collective//Monthly meeting//EN", "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:meeting-${meeting.month.slice(0, 7)}@aimedicinecollective.com`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${MEETING_TITLE}`,
    ];
    if (meeting.place) lines.push(`LOCATION:${escape(meeting.place)}`);
    lines.push("DESCRIPTION:Details: https://www.aimedicinecollective.com/schedule.html", "END:VEVENT", "END:VCALENDAR");
    return new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" });
  }

  function meetingPanel(meeting, poll) {
    const panel = el("article", "hub-detail meeting-confirmed");
    panel.append(
      el("h3", "hub-title", `Confirmed: ${monthLabel(meeting.month)} meeting`),
      el("p", "meeting-when", `${dayLabel(meeting.starts_at)}, ${timeLabel(meeting.starts_at)} Eastern (${meeting.minutes} minutes)`)
    );
    if (meeting.place) panel.append(el("p", "meeting-where", `Where: ${meeting.place}`));
    panel.append(el("p", "note",
      `// ${meeting.going} member${meeting.going === 1 ? "" : "s"} said they could make this time.`));

    const start = new Date(meeting.starts_at);
    const end = new Date(start.getTime() + meeting.minutes * 60000);
    const actions = el("div", "project-actions");
    const file = el("a", "project-launch-btn", "Add to calendar");
    file.href = URL.createObjectURL(calendarFile(meeting));
    file.download = "ai-medicine-collective-meeting.ics";
    const google = el("a", "project-doc-link", "Google Calendar");
    google.href = "https://calendar.google.com/calendar/render?action=TEMPLATE"
      + `&text=${encodeURIComponent(MEETING_TITLE)}`
      + `&dates=${stamp(start)}/${stamp(end)}`
      + (meeting.place ? `&location=${encodeURIComponent(meeting.place)}` : "")
      + `&details=${encodeURIComponent("Details: https://www.aimedicinecollective.com/schedule.html")}`;
    google.target = "_blank";
    google.rel = "noopener noreferrer";
    actions.append(file, google);
    panel.append(actions);

    if (poll.is_admin) {
      panel.append(button("Undo confirmation", "hub-tab meeting-undo", async () => {
        if (!window.confirm("Undo this confirmation? Nobody is emailed. You can then confirm a different time.")) return;
        if (await act(() => db.rpc("undo_meeting", { target: meeting.month }), "> COULD NOT UNDO.") !== undefined) load();
      }));
    }
    return panel;
  }

  /* ---- the poll ---- */

  function pollSection(poll) {
    const section = el("section", "meeting-poll");
    section.append(el("h3", "subsection-title", `// Vote: ${monthLabel(poll.month)} meeting`));

    const confirmed = poll.meetings.some((m) => m.month === poll.month);
    section.append(el("p", "note", poll.open
      ? `// Tick every time you could make. Times are Eastern. Voting closes ${dateLabel(poll.closes_on)}.`
      : confirmed
        ? "// This meeting is confirmed (above). Voting for the following month opens on the 1st."
        : `// Voting closed on ${dateLabel(poll.closes_on)}. Waiting for the organizer to confirm a time.`));

    const top = Math.max(0, ...poll.slots.map((s) => s.votes));
    const days = new Map();
    for (const slot of poll.slots) {
      const key = dayLabel(slot.slot);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(slot);
    }

    for (const [day, slots] of days) {
      const row = el("div", "poll-day");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", day);
      row.append(el("span", "poll-day-name", day));
      const times = el("div", "poll-times");
      for (const slot of slots) {
        const chip = button(`${timeLabel(slot.slot)} · ${slot.votes}`, "poll-slot", async () => {
          chip.disabled = true;
          if (await act(() => db.rpc("set_meeting_vote", { target_slot: slot.slot, can_attend: !slot.mine }),
            "> COULD NOT SAVE YOUR VOTE.") !== undefined) load();
          else chip.disabled = false;
        });
        chip.setAttribute("aria-pressed", String(slot.mine));
        chip.setAttribute("aria-label",
          `${day}, ${timeLabel(slot.slot)}: ${slot.votes} vote${slot.votes === 1 ? "" : "s"}${slot.mine ? ", including yours" : ""}`);
        if (top > 0 && slot.votes === top) chip.classList.add("is-top");
        chip.disabled = !poll.open;
        times.append(chip);
      }
      row.append(times);
      section.append(row);
    }
    section.append(el("p", "note", "// The number is how many members ticked that time. Brightest outline: most votes so far."));
    return section;
  }

  /* ---- admin: pick the slot ---- */

  function confirmSection(poll) {
    const section = el("section", "meeting-admin");
    section.append(el("h3", "subsection-title", "// Confirm the meeting (admin)"));

    const ranked = poll.slots.filter((s) => s.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 5);
    if (!ranked.length) {
      section.append(el("p", "note", "// No votes yet. Once members vote, the most popular times appear here."));
      return section;
    }

    const place = el("input", "join-input");
    place.id = "meeting-place";
    place.type = "text";
    place.maxLength = 300;
    place.placeholder = "Room, or a video link (optional)";
    const placeLabel = el("label", "join-label", "Where");
    placeLabel.htmlFor = place.id;
    const length = el("select", "join-input");
    length.id = "meeting-length";
    for (const minutes of [30, 60, 90]) {
      const option = el("option", null, `${minutes} minutes`);
      option.value = String(minutes);
      length.append(option);
    }
    const lengthLabel = el("label", "join-label", "Length");
    lengthLabel.htmlFor = length.id;
    const fields = el("div", "digest-row");
    fields.append(placeLabel, place, lengthLabel, length);
    section.append(
      el("p", "note", poll.open
        ? "// Voting is still open. Confirming now closes it. Everyone who ticked the time you pick is emailed a calendar invite."
        : "// Pick a time. Everyone who ticked it is emailed a calendar invite."),
      fields
    );

    const list = el("ul", "dash-list");
    for (const slot of ranked) {
      const li = el("li");
      li.append(
        el("span", null, `${dayLabel(slot.slot)}, ${timeLabel(slot.slot)}`),
        el("span", "member-tag", `${slot.votes} vote${slot.votes === 1 ? "" : "s"}`),
        button("> Confirm", "hub-tab hub-tab--submit", async () => {
          const when = `${dayLabel(slot.slot)} at ${timeLabel(slot.slot)} Eastern`;
          if (!window.confirm(`Confirm the meeting for ${when} and email the ${slot.votes} member(s) who ticked it?`)) return;
          const sent = await act(() => db.rpc("confirm_meeting", {
            target_slot: slot.slot,
            place: place.value.trim() || null,
            length_minutes: parseInt(length.value, 10),
          }), "> COULD NOT CONFIRM.");
          if (sent === undefined) return;
          await load();
          say(`> CONFIRMED. Calendar invites emailed to ${sent === true ? 0 : sent} member(s).`);
        })
      );
      list.append(li);
    }
    section.append(list);
    return section;
  }

  async function load() {
    const { data: poll, error } = await db.rpc("meeting_poll");
    if (error || !poll) {
      console.error(error);
      app.replaceChildren(el("p", "account-status is-error", "> THE MEETING POLL ISN'T AVAILABLE YET. Please try again later."));
      return;
    }
    const nodes = [status];
    poll.meetings.forEach((meeting) => nodes.push(meetingPanel(meeting, poll)));
    nodes.push(pollSection(poll));
    if (poll.is_admin && !poll.meetings.some((m) => m.month === poll.month)) nodes.push(confirmSection(poll));
    app.replaceChildren(...nodes);
  }

  (async () => {
    app.replaceChildren(loadingBlock("> CHECKING ACCESS..."));
    try {
      const { session, profile } = await getSessionAndProfile();
      const gate = (text, linkText) => {
        const link = el("a", "account-mod-link", linkText);
        link.href = "account.html";
        app.replaceChildren(el("p", "account-status", "> MEMBERS ONLY"), el("p", null, text), link);
      };
      if (!session) {
        return gate("The Collective meets in the first week of every month. Members vote on the time, get a calendar invite, and can read past minutes.",
          "> SIGN IN OR REQUEST MEMBERSHIP");
      }
      if (!profile || !["member", "moderator", "admin"].includes(profile.role)) {
        return gate("Your membership isn't active yet. Meetings open once a moderator approves your request.", "> CHECK YOUR STATUS");
      }
      if (archive) archive.hidden = false;
      await load();
    } catch (err) {
      console.error(err);
      app.replaceChildren(el("p", "account-status is-error", "> COULD NOT LOAD MEETINGS. Please refresh the page."));
    }
  })();
}

document.addEventListener("DOMContentLoaded", initMeetingsPage);
