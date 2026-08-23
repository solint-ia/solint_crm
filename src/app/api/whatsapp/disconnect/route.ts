import { NextResponse } from 'next/server';
import { whatsappService } from '@/infrastructure/whatsapp/whatsapp-service';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await whatsappService.disconnect();
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao desconectar WhatsApp';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
