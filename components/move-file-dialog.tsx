'use client';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import type { FileCard } from '@/lib/domain';

export type FileMove = { file: FileCard; stage: string; name: string };

export default function MoveFileDialog({ move, onClose, onConfirm }: {
  move: FileMove | null;
  onClose: () => void;
  onConfirm: (move: FileMove) => void;
}) {
  return <AlertDialog open={!!move} onOpenChange={open=>{if (!open) onClose();}}>
    <AlertDialogContent dir="rtl">
      <AlertDialogHeader>
        <AlertDialogTitle>نقل الملف إلى {move?.name}؟</AlertDialogTitle>
        <AlertDialogDescription>
          سيُنقل «{move?.file.name}» إلى المرحلة المختارة على اللوحة.
          {!move?.file.printed_at && <> لتسجيل الطباعة الفعلية، استخدم «تأكيد الطباعة» في تفاصيل الملف.</>}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>رجوع</AlertDialogCancel>
        <AlertDialogAction onClick={()=>{if (move) onConfirm(move);}}>تأكيد النقل</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
