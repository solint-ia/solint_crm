import { NextResponse } from 'next/server';
import { whatsappService } from '@/infrastructure/whatsapp/whatsapp-service';

export const dynamic = 'force-dynamic';

/** Leitura pontual do status — usada no primeiro render, antes do SSE abrir. */
export async function GET() {
  return NextResponse.json({ ok: true, status: whatsappService.getStatus() });
}
