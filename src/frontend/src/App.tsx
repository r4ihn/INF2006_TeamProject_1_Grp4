// Import statements
import { useEffect, useState } from "react";

// Function to check if app API is working
function App() {
  const [status, setStatus] = useState("checking...");

  useEffect(() => {
    fetch(`${import.meta.env.VITE_API_URL ?? "http://localhost:3000"}/health`)
    .then((res) => (res.ok ? setStatus("API healthy") : setStatus("API error"))) // If the respond is 200 say API healthy if not API error
    .catch( () => setStatus("API unreachable")); // Catch statement if both statements dont work at all
  
  }, []);

  return <h1>{status}</h1>; // Give back the statement in a static page
}

export default App;