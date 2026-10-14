import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { PDFDocument, StandardFonts } from "pdf-lib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "fixtures");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "acroform-fillable.pdf");

const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([612, 400]);
const form = pdfDoc.getForm();
const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
form.updateFieldAppearances(font);

const textSingle = form.createTextField("text_single");
textSingle.setText("hello");
textSingle.addToPage(page, { x: 50, y: 320, width: 200, height: 22, font });

const textMulti = form.createTextField("text_multiline");
textMulti.enableMultiline();
textMulti.addToPage(page, { x: 50, y: 250, width: 200, height: 50, font });

const check = form.createCheckBox("check_agree");
check.addToPage(page, { x: 50, y: 200, width: 18, height: 18 });

const dropdown = form.createDropdown("dropdown_choice");
dropdown.addOptions(["Alpha", "Beta"]);
dropdown.select("Alpha");
dropdown.addToPage(page, { x: 50, y: 150, width: 140, height: 22, font });

const radio = form.createRadioGroup("radio_pick");
radio.addOptionToPage("one", page, { x: 50, y: 100, width: 18, height: 18 });
radio.addOptionToPage("two", page, { x: 80, y: 100, width: 18, height: 18 });
radio.select("one");

const bytes = await pdfDoc.save();
writeFileSync(outPath, bytes);
console.log(`Wrote ${outPath} (${bytes.length} bytes)`);
