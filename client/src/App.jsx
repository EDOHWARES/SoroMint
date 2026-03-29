import React from "react"
import { useForm } from "react-hook-form"
import axios from "axios"

export default function App() {
  const { register, handleSubmit, formState: { errors } } = useForm()

  const onSubmit = async (data) => {
    console.log("Form submitted:", data)
    // Example: submit to API
    // await axios.post("/api/submit", data)
  }

  return (
    <div>
      <h1>Submit your data</h1>
      <form onSubmit={handleSubmit(onSubmit)}>
        <div>
          <label>Symbol</label>
          <input
            {...register("symbol", {
              required: "Symbol is required",
              pattern: {
                value: /^[A-Z]{1,5}$/,
                message: "Symbol must be 1-5 uppercase letters"
              }
            })}
          />
          {errors.symbol && <p style={{ color: "red" }}>{errors.symbol.message}</p>}
        </div>

        <div>
          <label>Name</label>
          <input
            {...register("name", {
              required: "Name is required",
              minLength: { value: 3, message: "Name must be at least 3 characters" }
            })}
          />
          {errors.name && <p style={{ color: "red" }}>{errors.name.message}</p>}
        </div>

        <button type="submit">Submit</button>
      </form>
    </div>
  )
}