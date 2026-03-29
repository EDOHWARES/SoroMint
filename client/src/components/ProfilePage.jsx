import React, { useState } from "react"
import QRCode from "qrcode.react"
import { Doughnut } from "react-chartjs-2"
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js"

ChartJS.register(ArcElement, Tooltip, Legend)

export default function ProfilePage() {
  const [displayName, setDisplayName] = useState("John Doe")
  const [avatarUrl, setAvatarUrl] = useState("https://via.placeholder.com/100")

  const balances = {
    XLM: 120,
    BTC: 0.5,
    ETH: 2,
  }

  const chartData = {
    labels: Object.keys(balances),
    datasets: [
      {
        label: "Wallet Balances",
        data: Object.values(balances),
        backgroundColor: ["#4CAF50", "#FF9800", "#2196F3"],
        borderWidth: 1,
      },
    ],
  }

  return (
    <div style={{ padding: "2rem" }}>
      <h1>Profile Page</h1>

      <div>
        <img src={avatarUrl} alt="avatar" width={100} height={100} />
        <h2>{displayName}</h2>
        <button onClick={() => alert("Edit display name/avatar")}>Edit</button>
      </div>

      <div style={{ marginTop: "2rem" }}>
        <h3>Wallet QR Code</h3>
        <QRCode value="GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" />
      </div>

      <div style={{ marginTop: "2rem", width: 300 }}>
        <h3>Balance Breakdown</h3>
        <Doughnut data={chartData} />
      </div>
    </div>
  )
}
