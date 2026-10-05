'use client';
import { FolderOpen } from 'lucide-react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
export function Picker({value,onChange,options,label,disabled=false}:{value:string;onChange:(v:string)=>void;options:{value:string;label:string}[];label:string;disabled?:boolean}){
  return <Select dir="rtl" value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger className="picker" aria-label={label}><SelectValue placeholder={label}/></SelectTrigger><SelectContent>{options.map(o=><SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent></Select>;
}
export function Blank({title,description,icon:Icon=FolderOpen,children}:{title:string;description?:string;icon?:typeof FolderOpen;children?:React.ReactNode}){return <Empty className="blank"><EmptyHeader><EmptyMedia variant="icon"><Icon/></EmptyMedia><EmptyTitle>{title}</EmptyTitle>{description&&<EmptyDescription>{description}</EmptyDescription>}</EmptyHeader>{children}</Empty>;}
