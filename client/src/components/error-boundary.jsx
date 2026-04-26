import React from 'react'
import { logFrontendError } from '../utils/error-logger'

function haveResetKeysChanged(prevResetKeys, nextResetKeys) {
  if (prevResetKeys === nextResetKeys) {
    return false
  }

  if (!Array.isArray(prevResetKeys) || !Array.isArray(nextResetKeys)) {
    return false
  }

  if (prevResetKeys.length !== nextResetKeys.length) {
    return true
  }

  return prevResetKeys.some((key, index) => !Object.is(key, nextResetKeys[index]))
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      error: null,
    }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, errorInfo) {
    logFrontendError(error, errorInfo, this.props.context)
  }

  componentDidUpdate(prevProps) {
    if (
      this.state.error &&
      haveResetKeysChanged(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.resetErrorBoundary()
    }
  }

  resetErrorBoundary = () => {
    this.setState({ error: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.error) {
      if (typeof this.props.fallbackRender === 'function') {
        return this.props.fallbackRender({
          error: this.state.error,
          resetErrorBoundary: this.resetErrorBoundary,
        })
      }

      return this.props.fallback ?? null
    }

    return this.props.children
  }
}

export default ErrorBoundary
