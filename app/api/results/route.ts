import { NextResponse } from 'next/server';
import { getDaily } from '@/lib/dailyStore';

function istDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export async function GET() {
  const date = istDate();
  return NextResponse.json(await getDaily(date), { headers: { 'Cache-Control': 'no-store' } });
}
