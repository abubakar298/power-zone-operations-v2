import { buildIpoPdf as bessIpo } from "./report-ubl-bess.js";
import { buildPeachtreePdf as bessPt } from "./peachtree-report-ubl-bess.js";
import { buildIpoPdf as originalIpo } from "./report.js";
import { buildPeachtreePdf as originalPt } from "./peachtree-report.js";
import { buildIpoPdf as currentIpo } from "./report-v4.js";
import { buildPeachtreePdf as currentPt } from "./peachtree-report-v4.js";
// Historical snapshots retain their original archived renderer.
export const buildIpoPdf = (
  s: any,
  number?: string,
  division = s.peachtree,
  options: { includePt?: boolean } = {},
) =>
  s.allocation?.policy === "ubl-bess-approved-proportional-v1"
    ? bessIpo(s, number, division, options)
    : s.documentLayoutVersion >= 4
      ? currentIpo(s, number, division, options)
      : originalIpo(s, number, division);
export const buildPeachtreePdf = (s: any, d: any, number: string) =>
  s.allocation?.policy === "ubl-bess-approved-proportional-v1"
    ? bessPt(s, d, number)
    : s.documentLayoutVersion >= 4
      ? currentPt(s, d, number)
      : originalPt(s, d, number);
