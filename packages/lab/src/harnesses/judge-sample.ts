/**
 * Judge-only smoke test.
 *
 * The macOS VoiceOver capture driver (Guidepup over AppleScript) is currently
 * unreliable on recent macOS. The capture mechanism and the core bet are
 * separable, so this exercises the JUDGE directly against a realistic
 * screen-reader transcript with deliberately planted accessibility problems.
 *
 * It proves the judge's reasoning and output, not end-to-end capture. The
 * question to evaluate: does it catch the planted issues, cite sensible WCAG
 * criteria, and avoid inventing problems that are not in the transcript?
 */
import { judge } from "@a11y-witness/judge";

// A realistic VoiceOver-style read-through of a contact form. Planted issues:
//  - heading order jumps from h1 straight to h4
//  - an image announced with no alternative text ("image")
//  - two form fields announced only as "edit text" (no label)
//  - a submit control announced only as "button" (no accessible name)
//  - a non-descriptive "click here" link
const transcript = [
  "Contact Us, heading level 1",
  "We would love to hear from you. Fill in the form below and we will reply within two working days.",
  "Get in touch, heading level 4",
  "image",
  "Name, edit text",
  "edit text",
  "Your message, edit text",
  "button",
  "For our privacy policy click here, link",
  "Contact Us, heading level 1",
];

async function main(): Promise<void> {
  const verdict = await judge({
    url: "https://example.com/contact  (sample transcript, not a live capture)",
    task: "Send a message to the team using the contact form",
    screenReader: "VoiceOver",
    transcript,
  });
  console.log(JSON.stringify(verdict, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
