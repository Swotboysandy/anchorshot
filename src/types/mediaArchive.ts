export interface LocalMediaArchive {
 version:1; sourceJobId:string; kind:'image'|'video'; prompt:string; seed:number;
 files:Array<{name:string;sha256:string;base64:string}>;
}
