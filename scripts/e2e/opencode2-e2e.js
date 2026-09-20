// 无头端到端验证：node-pty 驱动真实 opencode2 (beta)。
const os = require("os");
const path = require("path");
const pty = require("node-pty");

const ANSI = /(\x1b\[[0-9;?]*[A-Za-z])|(\x1b\][^\x07\x1b]*(\x07|\x1b\\)?)|(\x1b[PX^_][^\x1b]*\x1b\\)|(\x1b[=>NOPc78])|[\x00-\x08\x0b\x0c\x0e-\x1f]/g;
const strip = (s) => s.replace(ANSI, "");

const RESPONSES = [
  [/\x1b\[c/, "\x1b[?61;22c"],
  [/\x1b\[>0?c/, "\x1b[>0;276;0c"],
  [/\x1b\[6n/, "\x1b[1;1R"],
  [/\x1b\[>0q/, "\x1bP>|Microsoft Windows Terminal\x1b\\"],
  [/\x1b\[\?u/, "\x1b[?0u"],
  [/\x1b\[\?2026\$p/, "\x1b[?2026;2$y"],
];

const term = pty.spawn("cmd.exe", ["/c", "opencode2"], {
  name: "xterm-256color",
  cols: 120,
  rows: 34,
  cwd: path.join(os.homedir()),
  env: process.env,
});

let buf = "";
const answered = [];
term.onData((d) => {
  buf += d;
  for (const [pat, resp] of RESPONSES) {
    if (pat.test(d) && !answered.slice(-4).includes(resp)) {
      answered.push(resp);
      term.write(resp);
    }
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  try {
    await sleep(25000);
    let v = strip(buf);
    console.log("BOOT:", /Ask anything/.test(v), "| chars:", v.length);
    if (!/Ask anything|Greeting/.test(v)) {
      console.log("TAIL:", JSON.stringify(v.slice(-500)));
      process.exit(2);
    }

    term.write("/us");
    await sleep(3000);
    v = strip(buf);
    console.log("COMPLETION usage:", /usage/.test(v), "| TokenWatch:", /TokenWatch/.test(v));
    console.log("TAIL_AFTER_US:", JSON.stringify(strip(v).slice(-700)));

    term.write("age");
    await sleep(1500);
    term.write("\r");
    await sleep(5000);
    v = strip(buf);
    console.log("TAIL_AFTER_ENTER:", JSON.stringify(v.slice(-900)));
    const hits = ["HTML", "JSON"].filter((k) => v.includes(k)).length;
    console.log("MENU_HITS:", hits, "/2");
    console.log("VERDICT:", /usage/.test(v) && hits >= 2 ? "PASS" : "CHECK_MANUALLY");
  } catch (e) {
    console.error("ERR:", e);
  } finally {
    try { term.kill(); } catch {}
    setTimeout(() => process.exit(0), 500);
  }
})();
