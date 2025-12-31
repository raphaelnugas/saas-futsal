import React from 'react'

export interface FifaCardProps {
  name: string
  overall: number
  photoUrl?: string
  stats: {
    ofe: number
    def: number
    tec: number
    for: number
    vel: number
    pot: number
  }
  positionLabel?: string
  templateUrl: string
}

const FifaCard: React.FC<FifaCardProps> = ({ name, overall, photoUrl, stats, positionLabel, templateUrl }) => {
  return (
    <div
      className="relative h-full aspect-[500/708] bg-no-repeat bg-center bg-cover shadow-xl mx-auto"
      style={{ backgroundImage: `url(${templateUrl})` }}
    >
      <div className="absolute top-[15%] left-[12%] flex flex-col items-center text-[#3c3222]">
        <span className="text-3xl font-extrabold leading-none">{overall}</span>
        {positionLabel ? <span className="text-xs font-bold uppercase">{positionLabel}</span> : null}
      </div>
      {photoUrl ? (
        <img
          src={photoUrl}
          className="absolute top-[12%] left-1/2 -translate-x-1/2 w-[70%] z-0"
          alt={name}
        />
      ) : null}
      <div className="absolute top-[60%] left-0 w-full text-center z-10">
        <span className="text-xl font-bold text-[#3c3222] uppercase px-2">{name}</span>
      </div>
      <div className="absolute top-[75%] left-0 w-full px-4 z-10">
        <div className="grid grid-cols-3 gap-y-1 text-center text-[#3c3222]">
          <div><span className="block text-xs opacity-70">OFE</span><span className="font-bold">{stats.ofe}</span></div>
          <div><span className="block text-xs opacity-70">DEF</span><span className="font-bold">{stats.def}</span></div>
          <div><span className="block text-xs opacity-70">TEC</span><span className="font-bold">{stats.tec}</span></div>
          <div><span className="block text-xs opacity-70">FOR</span><span className="font-bold">{stats.for}</span></div>
          <div><span className="block text-xs opacity-70">VEL</span><span className="font-bold">{stats.vel}</span></div>
          <div><span className="block text-xs opacity-70">POT</span><span className="font-bold">{stats.pot}</span></div>
        </div>
      </div>
    </div>
  )
}

export default FifaCard
