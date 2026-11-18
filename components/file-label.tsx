'use client';

import { useState } from 'react';
import { Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FILE_LABEL_COLORS, type FileCard, type FileLabelColor } from '@/lib/domain';
import { Picker } from './controls';

type Label = { text: string; color: FileLabelColor };
const colors = Object.entries(FILE_LABEL_COLORS).map(([value,label])=>({value,label}));

export function FileLabel({ file }: { file: FileCard }) {
  if (!file.label_text || !file.label_color) return null;
  return <span className={`file-label file-label-${file.label_color}`} dir="auto">
    <Tag size={13} aria-hidden="true"/>{file.label_text}
  </span>;
}

export function FileLabelEditor({ file, disabled, onSave }: {
  file: FileCard;
  disabled: boolean;
  onSave: (label: Label | null) => Promise<boolean>;
}) {
  const [open,setOpen] = useState(false);
  const [text,setText] = useState('');
  const [color,setColor] = useState<FileLabelColor>('amber');

  async function save(label: Label | null) {
    if (await onSave(label)) setOpen(false);
  }

  return <div className="file-label-editor">
    <FileLabel file={file}/>
    <Button size="sm" variant="outline" disabled={disabled} onClick={()=>{
      setText(file.label_text??'');
      setColor(file.label_color??'amber');
      setOpen(true);
    }}><Tag size={15}/>{file.label_text?'تعديل التمييز':'تمييز الكارت'}</Button>
    <Dialog open={open} onOpenChange={value=>{if (!disabled) setOpen(value);}}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>تمييز كارت الملف</DialogTitle>
          <DialogDescription>يظهر النص واللون على الكارت لكل أعضاء الفريق.</DialogDescription>
        </DialogHeader>
        <form className="file-label-form" onSubmit={event=>{event.preventDefault();void save({text:text.trim(),color});}}>
          <label>نص التمييز<Input value={text} maxLength={40} onChange={event=>setText(event.target.value)}
            placeholder="مثال: أولوية اليوم" required disabled={disabled}/></label>
          <label>اللون<Picker label="لون التمييز" value={color} options={colors} disabled={disabled}
            onChange={value=>setColor(value as FileLabelColor)}/></label>
          <div className="file-actions">
            <Button disabled={disabled||!text.trim()}>حفظ التمييز</Button>
            {file.label_text&&<Button type="button" variant="outline" disabled={disabled} onClick={()=>void save(null)}>إزالة التمييز</Button>}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  </div>;
}
