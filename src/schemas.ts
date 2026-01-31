import { z } from "zod";

/* =========================
   Sub-schemas reutilizables
========================= */

const PhoneSchema = z.object({
  area_code: z.string().describe("Código de área."),
  number: z.number().describe("Número telefónico."),
});

const IdentificationSchema = z.object({
  type: z.string().describe("Tipo de identificación."),
  number: z.string().describe("Número de identificación."),
});

const AddressSchema = z.object({
  zip_code: z.string().describe("Código postal."),
  street_name: z.string().describe("Nombre de la calle."),
  street_number: z.number().describe("Número."),
});

const PayerSchema = z
  .object({
    name: z.string().describe("Nombre del comprador."),
    surname: z.string().describe("Apellido del comprador."),
    email: z.email().describe("Dirección de e-mail del comprador."),
    phone: PhoneSchema.describe("Teléfono del comprador."),
    identification: IdentificationSchema.describe("Identificación personal."),
    address: AddressSchema.describe("Dirección del comprador."),
    registration_date: z.string().describe("Fecha de registración."),
  })
  .describe("Información del comprador.");

/* =========================
   Payment methods
========================= */

const PaymentMethodIdSchema = z.object({
  id: z.string().describe("Identificador del método o tipo de pago."),
});

const PaymentMethodsSchema = z
  .object({
    excluded_payment_methods: z
      .array(PaymentMethodIdSchema)
      .describe("Métodos de pago excluidos del checkout."),
    excluded_payment_types: z
      .array(PaymentMethodIdSchema)
      .describe("Tipos de pago excluidos del checkout."),
    default_payment_method_id: z.string().describe("Forma de pago sugerida."),
    installments: z.number().describe("Máximo número de cuotas."),
    default_installments: z
      .number()
      .describe("Número estándar de cuotas ofrecidas."),
  })
  .describe("Configuración de métodos de pago.");

/* =========================
   Shipments
========================= */

const FreeMethodSchema = z.object({
  id: z.number().describe("Identificador de método de envío."),
});

const ReceiverAddressSchema = z.object({
  zip_code: z.string().describe("Código postal."),
  street_name: z.string().describe("Calle."),
  city_name: z.string().describe("Ciudad."),
  state_name: z.string().describe("Estado."),
  street_number: z.number().describe("Número."),
  floor: z.string().describe("Piso."),
  apartment: z.string().describe("Departamento."),
  country_name: z.string().describe("Nombre del país."),
});

const ShipmentsSchema = z
  .object({
    mode: z.enum(["custom", "me2", "not_specified"]).describe("Modo de envío."),
    local_pickup: z.boolean().describe("Preferencia de retiro en sucursal."),
    dimensions: z.string().describe("Dimensiones del paquete."),
    default_shipping_method: z
      .number()
      .describe("Método de envío predeterminado."),
    free_methods: z
      .array(FreeMethodSchema)
      .describe("Métodos de envío gratuitos."),
    cost: z.number().describe("Costo del envío."),
    free_shipping: z.boolean().describe("Preferencia de envío gratuito."),
    receiver_address: ReceiverAddressSchema.describe("Dirección de envío."),
  })
  .describe("Información de envío.");

/* =========================
   Back URLs
========================= */

const BackUrlsSchema = z
  .object({
    success: z.url().describe("URL de retorno ante pago aprobado."),
    pending: z.url().describe("URL de retorno ante pago pendiente."),
    failure: z.url().describe("URL de retorno ante pago cancelado."),
  })
  .describe("URLs de retorno del checkout.");

/* =========================
   Differential pricing
========================= */

const DifferentialPricingSchema = z
  .object({
    id: z.number().describe("Identificador de precio diferenciado."),
  })
  .describe("Configuración de precio diferencial.");

/* =========================
   Tracks
========================= */

const TrackValuesSchema = z.object({
  conversion_id: z.number().describe("ID de conversión."),
  conversion_label: z.string().describe("Etiqueta de conversión."),
  pixel_id: z.string().describe("Pixel de Facebook."),
});

const TrackSchema = z.object({
  type: z.enum(["google_ad", "facebook_ad"]).describe("Tipo de track."),
  values: TrackValuesSchema.describe("Valores de configuración del track."),
});

const TracksSchema = z.array(TrackSchema).describe("Tracks de seguimiento.");

/* =========================
   Root schema
========================= */

export const MercadoPagoPreferenceSchema = z.object({
  items: z
    .array(z.any())
    .describe("Información sobre el ítem.")
    .min(1)
    .describe("Campo requerido."),
  payer: PayerSchema.optional(),
  payment_methods: PaymentMethodsSchema.optional(),
  shipments: ShipmentsSchema.optional(),
  back_urls: BackUrlsSchema.optional(),
  notification_url: z.url().describe("URL de notificaciones.").optional(),
  statement_descriptor: z
    .string()
    .max(13)
    .describe("Texto visible en el resumen de la tarjeta.")
    .optional(),
  additional_info: z.string().describe("Información adicional.").optional(),
  auto_return: z
    .enum(["approved", "all"])
    .describe("Redirección automática al sitio.")
    .optional(),
  external_reference: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe("Referencia externa del sistema.")
    .optional(),
  expires: z.boolean().describe("Indica si la preferencia expira.").optional(),
  expiration_date_from: z.string().describe("Inicio de vigencia.").optional(),
  expiration_date_to: z.string().describe("Fin de vigencia.").optional(),
  marketplace: z.string().describe("Origen del pago / marketplace.").optional(),
  marketplace_fee: z.number().describe("Tarifa del marketplace.").optional(),
  differential_pricing: DifferentialPricingSchema.optional(),
  tracks: TracksSchema.optional(),
  metadata: z
    .record(z.any(), z.any())
    .describe("Metadata adicional en formato JSON.")
    .optional(),
});
