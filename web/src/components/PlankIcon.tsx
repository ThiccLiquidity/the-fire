// PLANK's mascot, used wherever PLANK (the prize) is shown. The art is the owner's; /plank.webp and the small
// /plank-icon.webp are cut from it with a transparent background.
export function PlankIcon({ big }: { big?: boolean }) {
  return <img src={import.meta.env.BASE_URL + (big ? "plank.webp" : "plank-icon.webp")} alt="" aria-hidden="true" className={big ? "plank-big" : "plank-ic"} draggable={false} />;
}
