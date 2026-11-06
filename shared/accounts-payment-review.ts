const reviewNotes:Record<string,string>={
  "system:Meezan Bank Limited:26-20243": "Confirm invoice/site identity: Accounts repeats 26-20243 for Qila Kalarwala and Sabzazar H Block with receipt dates 17-Jul-2026 and 6-Aug-2026. Recovery lists Sabzazar as 26-20244. Confirm each invoice and date before recording.",
  "system:Meezan Bank Limited:26-20204": "Confirm two installments for Shaheen: PKR 883,576 received 7-Aug-2026 and PKR 51,424 received 5-Oct-2026 (Recovery MBL Chint rows 94 and 119). Keep both dates; current form has one date per invoice. Do not substitute either date for the full receipt.",
  "cable:UPS 250:26-10875": "Confirm the received date, including year, specifically for Nawan Shahr extra-cable invoice 26-10875. Do not use the main-system payment date.",
  "cable:UPS 250:26-10982": "Confirm the received date, including year, specifically for Chikkanwala extra-cable invoice 26-10982. Do not use the main-system payment date.",
  "cable:UPS 250:27-10098": "Confirm cable invoice identity, whether the cable payment was received, and receipt date. Recovery uses 27-10098 for a PKR 450,000 main-system payment; that is not cable-payment evidence.",
  "cable:UPS 250:27-10152": "Confirm whether the PKR 7,500 cable balance was received and on what date. Recovery also uses 27-10152 for a main-system payment; keep these separate.",
  "cable:UPS 250:27-10170": "Confirm cable invoice identity, payment status and receipt date. Recovery also uses 27-10170 for a main-system payment; that must not settle the cable entry.",
  "cable:UPS 250:27-10177": "Confirm cable invoice identity, payment status and receipt date. Recovery also uses 27-10177 for a main-system payment; that must not settle the cable entry."
};
export function paymentReviewNote(id:string,sourceVersion:number){return sourceVersion===2||sourceVersion===3?reviewNotes[id]:undefined;}
