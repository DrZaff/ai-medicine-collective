# Moderation guide

For the Collective's moderators and admins. Written 2026-11-08 after the
national-readiness audit; the short version is on the Moderation page itself
("Moderator guide"). **This is a draft for the owner and moderators to edit.**
Change the criteria here and in `guideFold()` in `auth.js` together.

## The moderator team

- Aim for **3 to 5 active moderators** before membership grows past the
  founding group, so the queue never waits on one person. Agree among you who
  covers which weeks.
- Two moderators should agree before anyone is made a moderator. Admins change
  roles on the Moderation page (`set_member_role`).

## Approving membership requests

Approve:
- people who work or train in health care or a related field: students,
  residents, fellows, faculty, clinicians, researchers and staff;
- anyone a current member vouches for.

Check each request for a real name, a role and a program or institution
("About you", shown under each pending person). A work or school email
address is the strongest sign. When unsure, email the person and ask; don't
approve to clear the queue.

Decline:
- empty or one-word requests;
- sales, marketing or recruiting accounts, and organisations rather than
  people;
- anyone who has broken the community rules before.

Declining is not permanent: a declined person can ask again with more
detail.

## Reports

Members can report any chat message, comment, tool or material, tool request,
private message or profile. Reports go only to moderators; the person
reported is not told who reported them. Open reports appear at the top of the
Moderation page, **patient information first**, with a copy of the reported
text, so a private message can be judged without opening anyone's inbox.

For each report:
- **REMOVE IT** deletes the content for everyone (for a profile, CLEAR PROFILE
  removes what the person wrote about themselves and leaves them off the
  member list). Every open report on the same item closes with it.
- **DISMISS** closes the report and leaves the content.

Look at a report within **2 days**, and a patient-information report the
**same day**.

## If patient information is posted

Patient information is anything that could identify a patient: names, dates
(birth, admission, death), record or account numbers, addresses, photos,
images with identifiers, or case details rare enough to point to one person.

1. **Remove it at once**: REMOVE IT on the report, or the delete button where
   it was posted. Aim for within 24 hours of seeing it, and sooner for names,
   dates of birth, record numbers or photos.
2. **Don't copy, forward or screenshot it.** The report keeps a copy of the
   text only until the report is closed.
3. **Tell the person who posted it**, privately and without blame, what was
   removed and why.
4. **Tell the owner the same day**: the date, where it was posted, roughly how
   long it was visible and how many people could have seen it. Keep that note;
   never keep the information itself.
5. If it came from a hospital's or clinic's records, the person who posted it
   may need to tell their own institution's privacy office. Point them there.
   The Collective is a volunteer group and holds no patient records of its own.
6. If the same person does it again, a moderator may remove their membership
   (decline them on the Moderation page).

## Other content

- **Harassment or abuse:** remove it, and warn the person privately. Repeated
  or serious abuse: remove their membership.
- **Misleading or unsafe clinical content:** remove it if it could harm a
  patient if followed; otherwise reply in public with the evidence, or ask the
  author to correct it.
- **Spam and advertising:** remove it. Remove the account if it exists only to
  advertise.
- **Impersonation:** clear the profile, then ask the person to confirm who they
  are before restoring it.

## Things the database does for you

- Display names can't contain web addresses or claim a role such as admin,
  moderator or support (migration 021).
- Members can report up to 20 items an hour (migration 022).
- Either person in a private conversation can delete a message from it, and so
  can a moderator.
