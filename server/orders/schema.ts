import { z } from "zod";
const optional = z.string().trim().max(300).default("");
export const orderBasisInputSchema = z
  .object({
    quotationId: z.uuid(),
    entryVersion: z.literal(2).optional(),
    evidenceType: z.enum([
      "Customer PO",
      "Written approval",
      "WhatsApp approval",
      "Email approval",
      "Verbal sale confirmation",
    ]),
    evidenceNotes: z.string().trim().min(1).max(2000),
    orderNumber: z.string().trim().max(100).default(""),
    poNumber: z.string().trim().max(100).default(""),
    orderDate: z.iso.date(),
    deliveryDate: optional,
    invoiceCompany: z.string().trim().min(1).max(200),
    salesPerson: z.string().trim().min(1).max(100),
    customerAccepted: z.literal(true),
    customerNtn: optional,
    customerStrn: optional,
    designation: optional,
    contactPerson: optional,
    phone: optional,
    email: z.union([z.literal(""), z.email()]).default(""),
    billingAddress: z.string().trim().max(1000).default(""),
    deliveryAddress: z.string().trim().max(1000).default(""),
    siteContact: optional,
    sitePhone: optional,
    paymentContact: optional,
    paymentPhone: optional,
    deliveryTime: optional,
    paymentMode: optional,
    salesSource: optional,
    remarks: z.string().trim().max(2000).default(""),
    documentId: z.uuid().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.entryVersion === 2 &&
      (v.deliveryAddress ||
        v.siteContact ||
        v.sitePhone ||
        v.deliveryDate ||
        v.deliveryTime)
    )
      c.addIssue({
        code: "custom",
        message:
          "Delivery details must be entered by Operations after BOQ receipt.",
      });

  });
// Read-only commercial lookup precedes receipt entry; submitting a sale still requires its PO reference.
export const orderSchema = orderBasisInputSchema.superRefine((v, c) => {
    if (v.evidenceType === "Customer PO" && !v.poNumber)
      c.addIssue({
        code: "custom",
        message: "Enter the customer PO reference.",
      });
  });
export type OrderInput = z.infer<typeof orderSchema>;
