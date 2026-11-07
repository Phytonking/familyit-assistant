import "server-only";
import { LOOK_PROMPT, type WireTurn } from "@/lib/protocol";

// Scripted agent used when no ANTHROPIC_API_KEY is configured. It doesn't look at the
// images; it only knows whether frames were attached, so the call loop can be demoed.

interface Script {
  topic: string;
  match: RegExp;
  steps: string[];
}

const SCRIPTS: Script[] = [
  {
    topic: "gas",
    match: /\b(gas|propane|rotten egg|carbon monoxide|co alarm)\b/i,
    steps: [
      "Okay, safety first. If you smell gas, don't flip any switches or unplug anything, and don't light anything. Get everyone outside now, then call your gas company's emergency line or 911 from outside. Please don't try to fix this yourself.",
    ],
  },
  {
    topic: "electrical",
    match: /\b(spark|sparks|smoke|burning|scorch|breaker|outlet|socket|shock|exposed wire)/i,
    steps: [
      "Let's be careful here. {see} If you see smoke, scorch marks, or sparks, don't touch it. Switch off that circuit at the breaker panel if you can do it safely, and call an electrician.",
      "If it's just an outlet with no power and no burn marks, check whether it's a GFCI outlet with test and reset buttons, or whether a breaker has tripped. Point the camera at the outlet and I'll take a look.",
      "{see} If resetting doesn't bring it back, I'd leave the wiring to a licensed electrician. Is there anything else I can help with?",
    ],
  },
  {
    topic: "router",
    match: /\b(router|modem|wi-?fi|wifi|internet|network|orange light|amber|blinking|no connection|offline)\b/i,
    steps: [
      "Got it, sounds like a connection problem. {see} Can you point the camera at the front of the router so I can see all the status lights?",
      "Thanks. {see} An orange or amber light usually means the router has power but isn't getting internet from your provider. Let's restart it: unplug the power cable from the back, wait about thirty seconds, then plug it back in. Tell me when you've done that.",
      "Great. It can take two or three minutes to come back. Once the lights settle, show me the front again and tell me what color the internet light is.",
      "{see} If it's still orange, point the camera at the back so I can check the cable in the port labeled internet or W-A-N is clicked in firmly. If it is, this is likely an outage, and your provider's support line is the next step.",
    ],
  },
  {
    topic: "printer",
    match: /\b(printer|printing|print|paper jam|jam|ink|toner|cartridge)\b/i,
    steps: [
      "Okay, let's sort out the printer. {see} First, show me the printer's screen or its lights so I can see if it's reporting an error.",
      "{see} Let's check for a paper jam. Turn the printer off, then open the front or top cover and look for any crumpled paper. Point the camera inside and I'll help you spot it.",
      "If you see paper, pull it out slowly with both hands, in the direction the paper normally travels. Watch out, parts near the back can be hot. Then close the cover, turn it on, and tell me what the screen says.",
      "{see} Good. If it still won't print, try printing a test page from the printer's own menu. That tells us whether the problem is the printer or the computer connection.",
    ],
  },
  {
    topic: "cables",
    match: /\b(cable|cables|hdmi|port|ports|plug|usb|ethernet|which (one|wire)|where does|goes where|connect)/i,
    steps: [
      "Sure, let's figure out the cables. {see} Can you hold the end of the cable up to the camera so I can see the connector shape?",
      "{see} Now point the camera at the back of the device so I can see the ports and their labels.",
      "That connector matches the port on the left. Push it in straight until it's fully seated; you shouldn't need to force it. Tell me when it's in and I'll help you check it worked.",
    ],
  },
  {
    topic: "screen",
    match: /\b(error|screen|message|code|popup|pop-up|blue screen|warning|says)\b/i,
    steps: [
      "Let's read that error together. {see} Hold the camera steady about a foot from the screen so I can read the text clearly.",
      "{see} That message usually means the app couldn't finish what it was doing. Let's start simple: save anything you're working on, then restart the device and tell me if the message comes back.",
      "If it shows up again, read me any error code or number at the bottom of the message, and we'll look at the next step.",
    ],
  },
];

const GENERIC: Script = {
  topic: "generic",
  match: /.*/,
  steps: [
    "Okay, I'm with you. {see} Tell me a bit more about what's going wrong, and show me the part you're worried about.",
    "{see} Thanks, that helps. Let's take it one step at a time. What did you try already, and what happened?",
    "Got it. Let's try the simplest fix first: turn it off, wait thirty seconds, and turn it back on. Tell me what you see after that.",
  ],
};

const SEES_WITH_IMAGE = [
  "I can see what you're showing me.",
  "Okay, I've got your camera view.",
  "Thanks, I can see it now.",
];
const SEES_WITHOUT_IMAGE = "I can't see anything right now, it looks like your camera is off.";

function pickScript(turns: WireTurn[]): { script: Script; step: number } {
  const userTexts = turns.filter((t) => t.role === "user").map((t) => t.text);
  // Sticky topic: the most recent user turn that matches a script.
  for (let i = userTexts.length - 1; i >= 0; i--) {
    const script = SCRIPTS.find((s) => s.match.test(userTexts[i]));
    if (!script) continue;
    // Step = assistant turns since the topic first came up in this run.
    let firstIdx = turns.findIndex((t) => t.role === "user" && script.match.test(t.text));
    if (firstIdx < 0) firstIdx = 0;
    const step = turns.slice(firstIdx).filter((t) => t.role === "assistant").length;
    return { script, step };
  }
  return { script: GENERIC, step: turns.filter((t) => t.role === "assistant").length };
}

export function mockReplyText(turns: WireTurn[]): string {
  const last = turns[turns.length - 1];
  const hasImage = !!last.images?.length;
  const { script, step } = pickScript(turns);
  const sees = hasImage
    ? SEES_WITH_IMAGE[turns.length % SEES_WITH_IMAGE.length]
    : SEES_WITHOUT_IMAGE;

  let text: string;
  if (step >= script.steps.length) {
    text = "{see} It sounds like we've covered the main steps. If it's still not working, the manufacturer's support or a local technician is the next best bet. Anything else I can help with?";
  } else {
    text = script.steps[step];
  }
  if (last.text.includes(LOOK_PROMPT) && !text.includes("{see}")) text = `{see} ${text}`;
  return text.replace("{see}", sees).replace(/\s+/g, " ").trim();
}

/** Streams the scripted reply word by word, like a real model would. */
export async function* mockReply(turns: WireTurn[], signal: AbortSignal): AsyncGenerator<string> {
  const text = mockReplyText(turns);
  await sleep(450, signal); // "thinking"
  const words = text.split(" ");
  for (let i = 0; i < words.length; i++) {
    if (signal.aborted) return;
    yield (i === 0 ? "" : " ") + words[i];
    await sleep(35, signal);
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });
}
