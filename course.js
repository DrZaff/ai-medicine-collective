/* =============================================================
   COURSES (course-*.html): members-only lessons with exercises

   Loaded after script.js, whose readSignedInRole() decides who sees the
   course. That check is the same cosmetic hint the menu uses: the
   lessons are ordinary page text (like the Learning library), hidden to
   encourage joining, so nothing private may go in them.

   Exercises ("spot the slop"): a paragraph marked data-spot, in which the
   phrases to find are <span data-slop="why it's slop">. Every word becomes
   a button; tapping a word of a marked phrase flags the whole phrase.
   "Check my answers" marks what was found, missed and flagged by mistake,
   lists the reasons and shows a cleaner version.

   Progress ("Mark lesson N done") is kept on the device only.
   ============================================================= */

const COURSE_MEMBER_ROLES = ["member", "moderator", "admin"];

function initCourse() {
  const course = document.getElementById("course");
  const locked = document.getElementById("course-locked");
  if (!course) return;

  if (!COURSE_MEMBER_ROLES.includes(readSignedInRole())) {
    if (locked) locked.hidden = false;
    return;
  }
  course.hidden = false;

  const storeKey = `amc-course-${window.location.pathname.split("/").pop().replace(/\.html$/, "")}`;
  const lessons = [...course.querySelectorAll(".lesson")];

  // --- progress -----------------------------------------------------------
  const readDone = () => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storeKey) || "[]"));
    } catch {
      return new Set();
    }
  };
  const saveDone = (done) => {
    try {
      localStorage.setItem(storeKey, JSON.stringify([...done]));
    } catch {
      // private mode: progress lasts only for this visit
    }
  };
  let done = readDone();

  function showProgress() {
    const fill = document.getElementById("course-progress-fill");
    const text = document.getElementById("course-progress-text");
    const count = lessons.filter((lesson) => done.has(lesson.dataset.lesson)).length;
    if (fill) fill.style.width = `${(count / lessons.length) * 100}%`;
    if (text) {
      text.textContent = count === lessons.length
        ? `All ${lessons.length} lessons done. Keep the checklist below.`
        : `${count} of ${lessons.length} lessons done`;
    }
    lessons.forEach((lesson) => {
      const isDone = done.has(lesson.dataset.lesson);
      lesson.classList.toggle("is-done", isDone);
      const button = lesson.querySelector("[data-done]");
      if (button) {
        if (!button.dataset.label) button.dataset.label = button.textContent;
        button.textContent = isDone ? "✓ Done (undo)" : button.dataset.label;
        button.setAttribute("aria-pressed", String(isDone));
      }
    });
  }

  lessons.forEach((lesson, i) => {
    const button = lesson.querySelector("[data-done]");
    if (!button) return;
    button.addEventListener("click", () => {
      const id = lesson.dataset.lesson;
      if (done.has(id)) {
        done.delete(id);
      } else {
        done.add(id);
        // on to the next lesson
        const next = lessons[i + 1];
        if (next) {
          lesson.open = false;
          next.open = true;
          next.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
      saveDone(done);
      showProgress();
    });
  });
  showProgress();

  // --- the exercises ------------------------------------------------------
  course.querySelectorAll("[data-spot]").forEach((passage) => {
    const exercise = passage.closest(".exercise");
    const result = exercise.querySelector(".spot-result");
    const groups = [];

    // Turn the passage into word buttons. Marked phrases become one group.
    const wordButtons = (text, group) => text.split(/(\s+)/).map((piece) => {
      if (!piece || /^\s+$/.test(piece)) return document.createTextNode(piece);
      const word = document.createElement("button");
      word.type = "button";
      word.className = "spot-word";
      word.textContent = piece;
      if (group) {
        word.dataset.group = String(group.index);
        group.words.push(word);
      }
      return word;
    });
    [...passage.childNodes].forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        node.replaceWith(...wordButtons(node.textContent));
      } else if (node.nodeType === Node.ELEMENT_NODE && node.hasAttribute("data-slop")) {
        const group = { index: groups.length, why: node.dataset.slop, words: [], text: node.textContent.trim() };
        groups.push(group);
        node.replaceWith(...wordButtons(node.textContent, group));
      }
    });
    passage.classList.add("is-ready");

    let checked = false;
    passage.addEventListener("click", (event) => {
      const word = event.target.closest(".spot-word");
      if (!word || checked) return;
      const members = word.dataset.group ? groups[Number(word.dataset.group)].words : [word];
      const on = !word.classList.contains("is-flagged");
      members.forEach((w) => {
        w.classList.toggle("is-flagged", on);
        w.setAttribute("aria-pressed", String(on));
      });
    });

    exercise.querySelector("[data-spot-check]").addEventListener("click", () => {
      checked = true;
      let found = 0;
      groups.forEach((group) => {
        const hit = group.words.some((w) => w.classList.contains("is-flagged"));
        if (hit) found += 1;
        group.words.forEach((w) => w.classList.add(hit ? "is-found" : "is-missed"));
      });
      const extra = [...passage.querySelectorAll(".spot-word.is-flagged:not([data-group])")];
      extra.forEach((w) => w.classList.add("is-extra"));

      result.querySelector(".spot-score").textContent =
        `You found ${found} of ${groups.length}.` +
        (extra.length ? ` ${extra.length} word${extra.length === 1 ? " was" : "s were"} fine as written (marked).` : "") +
        (found === groups.length && !extra.length ? " Spot on." : "");
      const reasons = result.querySelector(".spot-reasons");
      reasons.replaceChildren(...groups.map((group) => {
        const item = document.createElement("li");
        const phrase = document.createElement("strong");
        phrase.textContent = `“${group.text}”`;
        item.append(phrase, ` ${group.why}`);
        return item;
      }));
      result.hidden = false;
    });

    exercise.querySelector("[data-spot-reset]").addEventListener("click", () => {
      checked = false;
      passage.querySelectorAll(".spot-word").forEach((w) => {
        w.classList.remove("is-flagged", "is-found", "is-missed", "is-extra");
        w.removeAttribute("aria-pressed");
      });
      result.hidden = true;
    });
  });

  // --- the checklist ------------------------------------------------------
  const print = course.querySelector("[data-print-checklist]");
  if (print) {
    print.addEventListener("click", () => {
      document.body.classList.add("print-checklist");
      window.print();
    });
    window.addEventListener("afterprint", () => document.body.classList.remove("print-checklist"));
  }
}

document.addEventListener("DOMContentLoaded", initCourse);
