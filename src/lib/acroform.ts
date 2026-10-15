import { PDFDocument, PDFCheckBox, PDFDropdown, PDFTextField, PDFRadioGroup } from "pdf-lib";

export type AcroFormField = {
  name: string;
  type: "text" | "textarea" | "checkbox" | "signature";
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  required: boolean;
};

export type AcroFormImportResult = {
  fields: AcroFormField[];
  errors: string[];
  warnings: string[];
};

const RENDER_WIDTH = 800;

/**
 * Extracts AcroForm fields from a fillable PDF and returns them in Nimmari's
 * field format, ready to be persisted and rendered as overlays.
 */
export async function extractAcroFormFields(pdfBytes: Uint8Array): Promise<AcroFormImportResult> {
  const pdf = await PDFDocument.load(pdfBytes);
  const form = pdf.getForm();
  const fields = form.getFields();
  const pages = pdf.getPages();
  const result: AcroFormField[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of fields) {
    const name = field.getName();
    const widgets = field.acroField.getWidgets();

    if (widgets.length === 0) {
      warnings.push(`Field "${name}" has no visual widgets (skipped)`);
      continue;
    }

    // Each field can have multiple widgets (appearances on different pages).
    // We create one Nimmari field per widget.
    for (const widget of widgets) {
      try {
        const pageRef = widget.P();
        if (!pageRef) {
          warnings.push(`Field "${name}" widget has no page reference (skipped)`);
          continue;
        }

        const pageIndex = pages.findIndex((p) => p.ref === pageRef);
        if (pageIndex === -1) {
          warnings.push(`Field "${name}" widget page not found (skipped)`);
          continue;
        }

        const page = pages[pageIndex];
        const pageHeight = page.getHeight();
        const pageWidth = page.getWidth();
        const scale = pageWidth / RENDER_WIDTH;

        const rect = widget.getRectangle();
        if (!rect) {
          warnings.push(`Field "${name}" widget has no rectangle (skipped)`);
          continue;
        }

        // PDF coordinates: bottom-left origin. Convert to top-left origin (our overlay system).
        const x = rect.x / scale;
        const y = (pageHeight - rect.y - rect.height) / scale;
        const width = rect.width / scale;
        const height = rect.height / scale;

        // Infer type from field instance
        let type: AcroFormField["type"] = "text";
        if (field instanceof PDFTextField) {
          type = field.isMultiline() ? "textarea" : "text";
        } else if (field instanceof PDFCheckBox) {
          type = "checkbox";
        } else if (field instanceof PDFDropdown) {
          warnings.push(`Dropdown field "${name}" imported as text field`);
          type = "text";
        } else if (field instanceof PDFRadioGroup) {
          warnings.push(`Radio group "${name}" imported as text field`);
          type = "text";
        }

        // Check if field is required (heuristic: some PDFs set flags, but not standard)
        const required = false; // AcroForms don't have a standard "required" flag; default to optional

        result.push({
          name,
          type,
          page: pageIndex,
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
          label: name, // Use field name as label; owner can rename later
          required,
        });
      } catch (error) {
        errors.push(`Failed to process field "${name}" widget: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { fields: result, errors, warnings };
}
