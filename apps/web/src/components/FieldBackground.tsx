/* The fixed mint→cyan field + three drifting colour blobs (from the comp). Sits behind
   every glass surface so it has something to refract. Pointer-events off; never interactive. */
export function FieldBackground() {
  return (
    <div aria-hidden className="field fixed inset-0 -z-10 overflow-hidden">
      <span
        className="absolute -left-[14%] -top-[16%] h-[48vmax] w-[48vmax] rounded-full opacity-60 blur-[80px] motion-safe:animate-[tl-blobdrift_18s_ease-in-out_infinite]"
        style={{ background: "radial-gradient(circle, rgba(0,224,138,0.22) 0%, rgba(0,224,138,0) 70%)" }}
      />
      <span
        className="absolute -right-[16%] top-[0%] h-[44vmax] w-[44vmax] rounded-full opacity-55 blur-[80px] motion-safe:animate-[tl-blobdrift_22s_ease-in-out_infinite_reverse]"
        style={{ background: "radial-gradient(circle, rgba(43,229,255,0.18) 0%, rgba(43,229,255,0) 70%)" }}
      />
      <span
        className="absolute bottom-[-22%] left-[30%] h-[42vmax] w-[42vmax] rounded-full opacity-40 blur-[90px] motion-safe:animate-[tl-blobdrift_26s_ease-in-out_infinite]"
        style={{ background: "radial-gradient(circle, rgba(255,106,77,0.12) 0%, rgba(255,106,77,0) 70%)" }}
      />
    </div>
  );
}

export default FieldBackground;
