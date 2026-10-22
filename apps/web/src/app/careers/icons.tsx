// The careers pages' icons, drawn as trendlix.com draws its own (thin line icons: the arrow up and to the right on its
// buttons, the chevron of "Scroll to explore", the three bars of its Menu, the cross that closes it). Decoration only:
// the text next to each says what it does.

type IconProps = { className?: string; strokeWidth?: number };

function Icon({ className = 'size-4', strokeWidth = 1.75, d }: IconProps & { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

/** To another page or site. */
export const ArrowUpRight = (p: IconProps) => <Icon {...p} d="M7 7h10v10M7 17 17 7" />;
/** Further down this page. */
export const ArrowDown = (p: IconProps) => <Icon {...p} d="M12 5v14M19 12l-7 7-7-7" />;
/** Back. */
export const ArrowLeft = (p: IconProps) => <Icon {...p} d="M12 19l-7-7 7-7M19 12H5" />;
export const ChevronDown = (p: IconProps) => <Icon {...p} d="m6 9 6 6 6-6" />;
/** The Menu: three thin bars standing up. */
export const MenuBars = (p: IconProps) => <Icon {...p} d="M6 4v16M12 4v16M18 4v16" />;
export const Cross = (p: IconProps) => <Icon {...p} d="M18 6 6 18M6 6l12 12" />;
