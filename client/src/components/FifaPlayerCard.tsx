import React from 'react'

export interface FifaPlayerCardProps {
  name: string
  overall: number
  role: string
  photoUrl?: string
  stats: {
    ofe: number
    def: number
    tec: number
    for: number
    vel: number
    pot: number
  }
  templateUrl: string
  className?: string
}

const FifaPlayerCard: React.FC<FifaPlayerCardProps> = ({ name, overall, role, photoUrl, stats, templateUrl, className }) => {
  const ordered = [
    { label: 'OFE', value: stats.ofe, order: 0 },
    { label: 'DEF', value: stats.def, order: 1 },
    { label: 'TEC', value: stats.tec, order: 2 },
    { label: 'FOR', value: stats.for, order: 3 },
    { label: 'VEL', value: stats.vel, order: 4 },
    { label: 'POT', value: stats.pot, order: 5 },
  ].sort((a, b) => (b.value - a.value) || (a.order - b.order)).slice(0, 3)
  return (
    <div className={className ? className : ''}>
      <div
        className="relative w-full aspect-[500/708] bg-no-repeat bg-center bg-cover shadow-xl mx-auto rounded-md"
        style={{ backgroundImage: `url(${templateUrl})` }}
      >
        <div className="absolute top-12 left-8 flex flex-col items-center text-[#3c3222]">
          <span className="text-4xl font-extrabold leading-none">{overall}</span>
          <span className="text-xs font-bold uppercase">{role}</span>
        </div>
        {photoUrl ? (
          <img
            src={photoUrl}
            className="absolute top-[10%] left-1/2 -translate-x-1/2 w-3/4 z-0"
            alt={name}
          />
        ) : null}
        <div className="absolute top-[64%] left-0 w-full text-center z-10">
          <span className="text-2xl font-bold text-[#3c3222] uppercase px-2">{name}</span>
        </div>
        <div className="absolute top-[75%] left-0 w-full px-8 z-10">
          <div className="grid grid-cols-3 gap-y-2 text-center text-[#3c3222]">
            {ordered.map((a, i) => (
              <div key={`${a.label}-${i}`}>
                <span className="block text-sm opacity-70">{a.label}</span>
                <span className="font-bold text-2xl">{a.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default FifaPlayerCard
