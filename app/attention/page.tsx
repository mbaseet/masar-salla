import { requireChatGPTUser } from '../chatgpt-auth';
import AttentionSheet from '@/components/attention-sheet';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/attention');return <AttentionSheet/>;}
