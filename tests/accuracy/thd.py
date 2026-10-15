import subprocess,struct,math,sys
f,hz=sys.argv[1],float(sys.argv[2]); extra=[float(x) for x in sys.argv[3:]]
r=subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ss','2','-t','2','-f','f64le','-'],capture_output=True).stdout
x=struct.unpack('<%dd'%(len(r)//8),r);sr=48000.0
def amp(fr):
    w=2*math.pi*fr/sr;n=len(x);c=sum(x[i]*math.cos(w*i) for i in range(n))*2/n;s=sum(x[i]*math.sin(w*i) for i in range(n))*2/n;return math.hypot(c,s)
a1=amp(hz);h=[amp(hz*k) for k in range(2,8)]
thd=math.sqrt(sum(v*v for v in h))/a1
pk=max(abs(v) for v in x)
out='fund %.1fdBFS peak %.1fdBFS THD %.2f%% (%.1fdB)'%(20*math.log10(a1),20*math.log10(pk),thd*100,20*math.log10(thd+1e-12))
if extra:
    hi=extra[0];ah=amp(hi);sb=math.sqrt(sum(amp(hi+k*hz*s)**2 for k in(1,2) for s in(1,-1)))/ah
    out+=' | IMD sidebands around %.0fHz: %.2f%% (%.1fdB)'%(hi,sb*100,20*math.log10(sb+1e-12))
print(out)
