/** Fills the control-family SOP Word template with docxtemplater. */
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

export function renderSopDocx(template: Uint8Array, data: object): Buffer {
  const doc = new Docxtemplater(new PizZip(template), { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}
