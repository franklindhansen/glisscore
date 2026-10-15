import subprocess,struct,math,sys
f,hz=sys.argv[1],float(sys.argv[2])
r=subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ss','1','-t','3','-f','f64le','-'],capture_output=True).stdout
x=struct.unpack('<%dd'%(len(r)//8),r)
sr=float(subprocess.run(['ffprobe','-v','error','-show_entries','stream=sample_rate','-of','csv=p=0',f],capture_output=True,text=True).stdout)
n=len(x);w=2*math.pi*hz/sr
c=sum(x[i]*math.cos(w*i) for i in range(n))*2/n;s=sum(x[i]*math.sin(w*i) for i in range(n))*2/n
rr=math.sqrt(sum((x[i]-c*math.cos(w*i)-s*math.sin(w*i))**2 for i in range(n))/n);t=math.hypot(c,s)/math.sqrt(2)
print(f,sr,'tone %.2fdBFS'%(20*math.log10(t)),'steady-state residual %.1fdB'%(20*math.log10(rr/t)))
