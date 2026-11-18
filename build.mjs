import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = new URL("./", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");
const htmlPath = new URL("index.html", root);
const stylesheet = '<link rel="stylesheet" href="./style.css">';
const script = '<script type="module" src="./app.js"></script>';

const [template, style, license, bundle] = await Promise.all([
  read("index.template.html"),
  read("style.css"),
  read("vendor/three.LICENSE"),
  build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ["app.js"],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2020",
    supported: { "template-literal": false },
    write: false,
    minify: true,
    charset: "utf8",
    legalComments: "none",
  }),
]);

if (template.split(stylesheet).length !== 2 || template.split(script).length !== 2) {
  throw new Error("index.template.html must contain one link to style.css and one module tag for app.js.");
}

const javascript = bundle.outputFiles[0].text.trimEnd().replace(/<\/script/gi, "<\\/script");
const browserHtml = template
  .replace(stylesheet, () => `<style>\n${style.trim()}\n</style>`)
  .replace(script, () => `<!--\n${license.trim()}\n-->\n<script>\n${javascript}\n</script>`);
const output = `<!-- Generated with npm run build. Edit index.template.html, style.css, or the JS modules. -->\n${browserHtml.trim()}\n`
  .replace(/\r\n/g, "\n");

if (process.argv.includes("--check")) {
  const existing = await read("index.html").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  if (existing.replace(/\r\n/g, "\n") !== output) {
    console.error("index.html needs to be rebuilt with npm run build.");
    process.exitCode = 1;
  }
} else {
  await writeFile(htmlPath, output);
  console.log(`Built index.html (${Buffer.byteLength(output).toLocaleString("en-US")} bytes).`);
}
