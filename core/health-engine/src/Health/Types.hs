-- | 健康分析引擎内部只读配置与版本元数据定义（无 IO、无全局可变状态）。
{-# LANGUAGE OverloadedStrings #-}

module Health.Types
  ( EngineInfo (..)
  , engineInfo
  , severityRank
  , maxSeverity
  ) where

import Data.Text (Text)
import Lhm.Protocol (Severity (..))

data EngineInfo = EngineInfo
  { engineVersion :: Text
  , engineProtocolVersion :: Text
  }
  deriving (Eq, Show)

engineInfo :: EngineInfo
engineInfo =
  EngineInfo
    { engineVersion = "0.1.0"
    , engineProtocolVersion = "1.1"
    }

severityRank :: Severity -> Int
severityRank SeverityNormal = 0
severityRank SeverityUnknown = 1
severityRank SeverityWarning = 2
severityRank SeverityCritical = 3

maxSeverity :: Severity -> Severity -> Severity
maxSeverity a b = if severityRank a >= severityRank b then a else b
