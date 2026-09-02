-- A sincronização completa da agenda pode gerar uma notificação de segurança
-- no WhatsApp Business. Este instante permite limitar cliques repetidos sem
-- guardar estado apenas na instância efêmera do site.
ALTER TABLE "WhatsAppConnection"
  ADD COLUMN "lastContactsSyncAt" TIMESTAMP(3);
